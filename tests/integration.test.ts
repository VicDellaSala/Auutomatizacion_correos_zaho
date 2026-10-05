import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Database } from "../src/lib/db";
import * as s from "../src/lib/db/schema";
import {
  approve,
  ingestBatch,
  preview,
  reject,
  revert,
  discard,
  decide,
} from "../src/lib/imports/service";
import { metrics, mailList } from "../src/lib/metrics/query";
import {
  backupLines,
  stageRestore,
  finishRestore,
  commitRestore,
  type BackupTable,
} from "../src/lib/backup/service";
import { reportHtml } from "../src/lib/reports/html";
import { requestMail, responseMail, mailbox, staff, eml } from "./fixtures";
import { parseEmail } from "../src/lib/email/mime-parser";
let pg: PGlite, db: Database;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(readFileSync("drizzle/0000_smart_pestilence.sql", "utf8"));
  db = drizzle(pg, { schema: s }) as unknown as Database;
});
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE agents,settings,imports,emails,users,restore_jobs CASCADE",
  );
  await db.insert(s.settings).values({ id: 1, mailbox });
  await db.insert(s.agents).values({ name: "Agente", email: staff });
});
afterAll(async () => {
  await pg.close();
});
async function create() {
  const [i] = await db
    .insert(s.imports)
    .values({
      filename: "synthetic.zip",
      size: 100,
      fingerprint: "a".repeat(64),
      total: 1,
      createdBy: "test@example.test",
    })
    .returning();
  return i.id;
}
async function stage(
  id: string,
  mails: Awaited<ReturnType<typeof parseEmail>>[],
) {
  await ingestBatch(
    db,
    id,
    mails.map((data, i) => ({ sourceFile: `${i}.eml`, data })),
    mails.length,
  );
  await db
    .update(s.imports)
    .set({ status: "READY_FOR_REVIEW" })
    .where(eq(s.imports.id, id));
}
describe("Transacciones reales en PostgreSQL (PGlite)", () => {
  it("requisito crítico: staging del día siguiente no cambia dashboard hasta aprobación", async () => {
    const a = await create(),
      request = await requestMail();
    await stage(a, [request]);
    expect((await metrics(db, {})).received).toBe(0);
    expect((await mailList(db, { q: "Cambio" })).count).toBe(0);
    await approve(db, a, "all", "reviewer@test");
    expect(await metrics(db, {})).toMatchObject({
      received: 1,
      answered: 0,
      unanswered: 1,
    });
    const b = await create();
    await stage(b, [await responseMail()]);
    expect((await preview(db, b)).changes).toEqual([request.key]);
    expect((await metrics(db, {})).answered).toBe(0);
    await approve(db, b, "all", "reviewer@test");
    expect(await metrics(db, {})).toMatchObject({
      received: 1,
      answered: 1,
      unanswered: 0,
      average: 86400,
    });
  });
  it("aprobación parcial y rechazo nunca publican el resto", async () => {
    const id = await create();
    await stage(id, [
      await requestMail("a@test"),
      await requestMail("b@test"),
      await requestMail("c@test"),
    ]);
    const rows = await db.select().from(s.stagedEmails);
    await approve(db, id, [rows[0].id], "reviewer");
    expect((await db.select().from(s.imports))[0].status).toBe(
      "PARTIALLY_APPROVED",
    );
    await reject(db, id, [rows[1].id]);
    expect((await metrics(db, {})).received).toBe(1);
    expect(
      (await db.select().from(s.stagedEmails)).filter(
        (r) => r.state === "PENDING",
      ),
    ).toHaveLength(1);
  });
  it("ZIP repetido y retransmisión de lote no duplican estadísticas", async () => {
    const mail = await requestMail();
    const id = await create();
    await ingestBatch(db, id, [{ sourceFile: "0.eml", data: mail }], 1);
    await ingestBatch(db, id, [{ sourceFile: "0.eml", data: mail }], 1);
    expect(await db.select().from(s.stagedEmails)).toHaveLength(1);
    await db
      .update(s.imports)
      .set({ status: "READY_FOR_REVIEW" })
      .where(eq(s.imports.id, id));
    await approve(db, id, "all", "reviewer");
    const b = await create();
    await stage(b, [mail]);
    await approve(db, b, "all", "reviewer");
    expect((await metrics(db, {})).received).toBe(1);
    expect(await db.select().from(s.emailImports)).toHaveLength(2);
    await revert(db, id);
    expect((await metrics(db, {})).received).toBe(1);
    await revert(db, b);
    expect((await metrics(db, {})).received).toBe(0);
  });
  it("aprobación de respuesta sin original seleccionado hace rollback completo", async () => {
    const id = await create();
    const response = await responseMail();
    await stage(id, [await requestMail(), response]);
    const [r] = await db
      .select()
      .from(s.stagedEmails)
      .where(eq(s.stagedEmails.key, response.key));
    await expect(approve(db, id, [r.id], "reviewer")).rejects.toThrow(
      "sin resolver",
    );
    expect(await db.select().from(s.emails)).toHaveLength(0);
    expect(await db.select().from(s.emailImports)).toHaveLength(0);
    await approve(db, id, "all", "reviewer");
    expect((await metrics(db, {})).answered).toBe(1);
  });
  it("múltiples respuestas mantienen la primera por fecha, no por orden de carga", async () => {
    const a = await create();
    await stage(a, [
      await requestMail(),
      await responseMail(
        "late@test",
        "request@test",
        "Mon, 05 Oct 2026 09:00:00 -0400",
      ),
    ]);
    await approve(db, a, "all", "reviewer");
    const b = await create();
    await stage(b, [await responseMail()]);
    await approve(db, b, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      average: 86400,
      team: [{ name: "Agente", responses: 2, requests: 1 }],
    });
  });
  it("cancelación, error individual y reproceso conservan lo guardado", async () => {
    const id = await create(),
      a = await requestMail("a@test"),
      b = await requestMail("b@test");
    await ingestBatch(
      db,
      id,
      [
        { sourceFile: "0.eml", data: a },
        { sourceFile: "1.eml", error: "Corrupto" },
      ],
      2,
    );
    await db
      .update(s.imports)
      .set({ status: "PARTIAL" })
      .where(eq(s.imports.id, id));
    await ingestBatch(
      db,
      id,
      [
        { sourceFile: "0.eml", data: a },
        { sourceFile: "1.eml", data: b },
      ],
      2,
    );
    expect(await db.select().from(s.stagedEmails)).toHaveLength(2);
    expect(
      (await db.select().from(s.importEntries)).every((e) => !e.error),
    ).toBe(true);
    expect((await metrics(db, {})).received).toBe(0);
  });
  it("descartar staging no altera el histórico aprobado", async () => {
    const a = await create();
    await stage(a, [await requestMail()]);
    await approve(db, a, "all", "reviewer");
    const b = await create();
    await stage(b, [await responseMail()]);
    await discard(db, b);
    expect(await metrics(db, {})).toMatchObject({ received: 1, answered: 0 });
    expect(
      await db
        .select()
        .from(s.stagedEmails)
        .where(eq(s.stagedEmails.importId, b)),
    ).toHaveLength(0);
  });
  it("clasificación manual permite resolver un caso dudoso sin publicarlo antes", async () => {
    const id = await create();
    const request = await requestMail(),
      response = await responseMail("manual@test", "missing@test");
    await stage(id, [request, response]);
    const [row] = await db
      .select()
      .from(s.stagedEmails)
      .where(eq(s.stagedEmails.key, response.key));
    await decide(db, id, row.id, { kind: "RESPONSE", targetKey: request.key });
    expect((await metrics(db, {})).received).toBe(0);
    await approve(db, id, "all", "reviewer");
    expect((await metrics(db, {})).answered).toBe(1);
  });
  it("correos iniciados no elevan respuestas por persona", async () => {
    const id = await create();
    await stage(id, [await parseEmail(eml({ from: staff }))]);
    await approve(db, id, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      received: 0,
      team: [],
      initiated: [{ name: "Agente", count: 1 }],
    });
  });
  it("filtros por recepción incluyen respuesta del siguiente día y búsqueda por cuerpo", async () => {
    const id = await create();
    await stage(id, [await requestMail(), await responseMail()]);
    await approve(db, id, "all", "reviewer");
    expect(
      (await metrics(db, { from: "2026-10-03", to: "2026-10-03" })).answered,
    ).toBe(1);
    expect((await mailList(db, { q: "Cambio realizado" })).count).toBe(1);
    expect(
      (await metrics(db, { from: "2026-10-04", to: "2026-10-04" })).received,
    ).toBe(0);
  });
  it("reporte HTML escapa contenido corporativo y no depende de recursos externos", async () => {
    const id = await create();
    await stage(id, [await requestMail()]);
    await approve(db, id, "all", "reviewer");
    let html = "";
    for await (const part of reportHtml(db, {})) html += part;
    expect(html).toContain("Solicitudes respondidas");
    expect(html).toContain("Correos no respondidos");
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
  });
  it("respaldo valida cantidades y restaura transaccionalmente sin tocar usuarios", async () => {
    const id = await create();
    await stage(id, [await requestMail(), await responseMail()]);
    await approve(db, id, "all", "reviewer");
    const [user] = await db
      .insert(s.users)
      .values({
        email: "admin@example.test",
        name: "Admin",
        passwordHash: "test-only",
      })
      .returning();
    const lines = [];
    for await (const line of backupLines(db)) lines.push(JSON.parse(line));
    const [job] = await db
      .insert(s.restoreJobs)
      .values({ userId: user.id })
      .returning();
    const rows = lines.slice(1, -1).map((line, i) => ({
      line: i,
      table: line.table as BackupTable,
      data: line.data,
    }));
    await stageRestore(db, job.id, user.id, rows);
    await expect(
      finishRestore(db, job.id, user.id, { settings: 2 }),
    ).rejects.toThrow("incompleto");
    await finishRestore(db, job.id, user.id, lines.at(-1).counts);
    await discard(db, id);
    await commitRestore(db, job.id, user.id);
    expect((await metrics(db, {})).answered).toBe(1);
    expect(await db.select().from(s.users)).toHaveLength(1);
  });
});
