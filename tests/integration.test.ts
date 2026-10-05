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
import { authenticateSharedAccess } from "../src/lib/auth/shared-access";
import { cleanupPreview, cleanupCommit } from "../src/lib/imports/cleanup";
import { refreshPendingStaff } from "../src/lib/imports/staff";
import {
  businessSeconds,
  businessTimeSql,
} from "../src/lib/metrics/business-time";
import { sql } from "drizzle-orm";
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
it("inicia acceso compartido sin crear un usuario manual y reutiliza su identidad", async () => {
  expect(await db.select().from(s.users)).toHaveLength(0);
  const first = await authenticateSharedAccess(
    db,
    "synthetic-key",
    "synthetic-key",
  );
  expect(first?.name).toBe("Acceso compartido");
  const second = await authenticateSharedAccess(
    db,
    "synthetic-key",
    "synthetic-key",
  );
  expect(second?.id).toBe(first?.id);
  expect(await db.select().from(s.users)).toHaveLength(1);
  expect(first?.passwordHash).not.toContain("synthetic-key");
});
it("bloquea cinco intentos fallidos y permite recuperación después de quince minutos", async () => {
  const now = new Date("2026-10-04T15:00:00Z");
  for (let i = 0; i < 5; i++)
    expect(
      await authenticateSharedAccess(db, "wrong", "synthetic-key", now),
    ).toBeNull();
  expect(
    await authenticateSharedAccess(db, "synthetic-key", "synthetic-key", now),
  ).toBeNull();
  const later = new Date(now.getTime() + 16 * 60000);
  expect(
    await authenticateSharedAccess(db, "wrong", "synthetic-key", later),
  ).toBeNull();
  expect((await db.select().from(s.users))[0].failedAttempts).toBe(1);
  expect(
    await authenticateSharedAccess(db, "synthetic-key", "synthetic-key", later),
  ).not.toBeNull();
  expect((await db.select().from(s.users))[0].failedAttempts).toBe(0);
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
  it("una relación aprobada no cambia por otra solicitud similar ni se reasigna tras borrar su original", async () => {
    const a = await create(),
      original = await requestMail();
    await stage(a, [original]);
    await approve(db, a, "all", "reviewer");
    const b = await create(),
      response = await responseMail();
    response.inReplyTo = [];
    response.references = [];
    await stage(b, [response]);
    await approve(db, b, "all", "reviewer");
    const c = await create();
    await stage(c, [await requestMail("similar@test")]);
    await approve(db, c, "all", "reviewer");
    expect(
      (
        await db.select().from(s.emails).where(eq(s.emails.key, response.key))
      )[0].rootKey,
    ).toBe(original.key);
    await revert(db, a);
    expect((await metrics(db, {})).answered).toBe(0);
    const d = await create();
    await stage(d, [await requestMail("another@test")]);
    await approve(db, d, "all", "reviewer");
    expect((await metrics(db, {})).answered).toBe(0);
    expect(
      (
        await db.select().from(s.emails).where(eq(s.emails.key, response.key))
      )[0],
    ).toMatchObject({ kind: "REVIEW", rootKey: original.key });
    const restored = await create();
    await stage(restored, [original]);
    await approve(db, restored, "all", "reviewer");
    expect((await metrics(db, {})).answered).toBe(1);
  });
  it("errores detallados de aprobación identifican correo y motivo sin incorporar registros", async () => {
    const id = await create(),
      mail = await responseMail("orphan@test", "absent@test");
    await stage(id, [mail]);
    const [row] = await db.select().from(s.stagedEmails);
    await expect(approve(db, id, "all", "reviewer")).rejects.toMatchObject({
      issues: [
        { id: row.id, subject: mail.subject, reason: expect.any(String) },
      ],
    });
    expect(await db.select().from(s.emails)).toHaveLength(0);
    expect((await db.select().from(s.stagedEmails))[0].state).toBe("PENDING");
  });
  it("dos ZIP en una importación, dos respuestas y una sola solicitud atendida", async () => {
    const id = await create(),
      a = await requestMail(),
      b = await responseMail(),
      c = await responseMail(
        "extra@test",
        "request@test",
        "Sun, 04 Oct 2026 09:01:00 -0400",
      );
    await ingestBatch(
      db,
      id,
      [{ sourceFile: "0:[ZIP 1 primera.zip]/0.eml", data: a }],
      3,
    );
    await ingestBatch(
      db,
      id,
      [
        { sourceFile: "1:[ZIP 2 segunda.zip]/0.eml", data: b },
        { sourceFile: "2:[ZIP 2 segunda.zip]/1.eml", data: c },
      ],
      3,
    );
    await db
      .update(s.imports)
      .set({ status: "READY_FOR_REVIEW" })
      .where(eq(s.imports.id, id));
    const proposed = await preview(db, id);
    expect(proposed).toMatchObject({
      answered: 1,
      unanswered: 0,
      counts: { REQUEST: 1, RESPONSE: 2, REVIEW: 0 },
    });
    expect((await metrics(db, {})).received).toBe(0);
    await approve(db, id, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      received: 1,
      answered: 1,
      responses: 2,
      team: [{ name: "Agente", responses: 2, requests: 1 }],
    });
    expect((await db.select().from(s.conversations))[0].firstResponseKey).toBe(
      b.key,
    );
  });
  it("82 solicitudes: aprobar 30 deja 52 pendientes y permite seguir aprobando y rechazando", async () => {
    const id = await create();
    await stage(
      id,
      await Promise.all(
        Array.from({ length: 82 }, (_, i) => requestMail(`page-${i}@test`)),
      ),
    );
    const rows = await db.select().from(s.stagedEmails);
    await approve(
      db,
      id,
      rows.slice(0, 30).map((r) => r.id),
      "reviewer",
    );
    expect((await preview(db, id)).counts.REQUEST).toBe(52);
    await approve(
      db,
      id,
      rows.slice(30, 60).map((r) => r.id),
      "reviewer",
    );
    await reject(db, id, [rows[60].id]);
    expect((await preview(db, id)).counts.REQUEST).toBe(21);
    await approve(db, id, "all", "reviewer");
    expect((await metrics(db, {})).received).toBe(81);
  });
  it("Julia existente en staging se reevalúa sin alterar el histórico", async () => {
    const id = await create(),
      a = await requestMail(),
      b = await responseMail();
    b.from = { name: "Julia", address: "julia.lanz@credicard.com.ve" };
    await stage(id, [a, b]);
    // Simulate staging created before Julia was configured.
    await db.delete(s.agents).where(eq(s.agents.email, b.from.address));
    await db
      .update(s.stagedEmails)
      .set({ staffName: null })
      .where(eq(s.stagedEmails.key, b.key));
    expect((await preview(db, id)).matches.get(b.key)?.kind).toBe("RESPONSE");
    expect((await metrics(db, {})).received).toBe(0);
    await approve(db, id, "all", "reviewer");
    expect((await metrics(db, {})).team[0].name).toBe("Julia Lanz G");
    const next = await create(),
      c = await responseMail("newstaff@test");
    c.from.address = "new@example.test";
    await stage(next, [c]);
    await db
      .insert(s.agents)
      .values({ name: "Nueva persona", email: c.from.address });
    await refreshPendingStaff(db);
    expect((await preview(db, next)).matches.get(c.key)?.kind).toBe("RESPONSE");
  });
  it("rechaza asociación propia u otra respuesta y verifica la relación manual guardada", async () => {
    const id = await create(),
      a = await requestMail(),
      b = await responseMail(),
      c = await responseMail(
        "extra@test",
        "request@test",
        "Sun, 04 Oct 2026 09:01:00 -0400",
      );
    await stage(id, [a, b, c]);
    const [row] = await db
      .select()
      .from(s.stagedEmails)
      .where(eq(s.stagedEmails.key, c.key));
    await expect(
      decide(db, id, row.id, { kind: "RESPONSE", targetKey: c.key }),
    ).rejects.toThrow();
    await expect(
      decide(db, id, row.id, { kind: "RESPONSE", targetKey: b.key }),
    ).rejects.toThrow();
    await decide(db, id, row.id, { kind: "RESPONSE", targetKey: a.key });
    expect((await preview(db, id)).matches.get(c.key)?.reason).toBe(
      "Asociación manual verificada",
    );
    expect(await approve(db, id, [row.id], "reviewer")).toBe(2);
  });
  it("marcar no respondida excluye asociaciones actuales y permite una respuesta futura", async () => {
    const id = await create(),
      a = await requestMail(),
      b = await responseMail();
    await stage(id, [a, b]);
    const [row] = await db
      .select()
      .from(s.stagedEmails)
      .where(eq(s.stagedEmails.key, a.key));
    await decide(db, id, row.id, {
      kind: "REQUEST",
      requestStatus: "UNANSWERED",
    });
    expect((await preview(db, id)).unanswered).toBe(1);
    await approve(db, id, [row.id], "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      received: 1,
      unanswered: 1,
      answered: 0,
      responses: 0,
    });
    const next = await create();
    await stage(next, [await responseMail("later@test")]);
    expect((await preview(db, next)).changes).toEqual([a.key]);
    await approve(db, next, "all", "reviewer");
    expect((await metrics(db, {})).answered).toBe(1);
  });
  it.each([
    ["16:58", "08:01", 1, 180],
    ["18:00", "08:05", 1, 300],
    ["07:20", "08:10", 0, 600],
    ["15:30", "16:15", 0, 2700],
    ["16:30", "09:00", 1, 5400],
  ])(
    "horario diario SQL y JS: %s → %s (+%s días) = %s segundos",
    async (a, b, days, seconds) => {
      const start = `2026-10-03T${a}:00-04:00`,
        end = `2026-10-0${3 + Number(days)}T${b}:00-04:00`;
      expect(businessSeconds(start, end)).toBe(seconds);
      const result = await db.execute(
        sql`select ${businessTimeSql(sql`${start}::timestamptz`, sql`${end}::timestamptz`)} as seconds`,
      );
      expect(Number(result.rows[0].seconds)).toBe(seconds);
    },
  );
  it("limpieza por hora de importación conserva compartidos, otras importaciones y configuración", async () => {
    const first = await create(),
      second = await create(),
      third = await create(),
      a = await requestMail();
    await stage(first, [a]);
    await approve(db, first, "all", "reviewer");
    await stage(second, [a, await responseMail()]);
    await approve(db, second, "all", "reviewer");
    await stage(third, [await requestMail("other@test")]);
    await approve(db, third, "all", "reviewer");
    for (const [id, date] of [
      [first, "2026-10-05T09:00:00-04:00"],
      [second, "2026-10-05T10:00:00-04:00"],
      [third, "2026-10-05T12:00:00-04:00"],
    ])
      await db
        .update(s.imports)
        .set({ createdAt: new Date(date) })
        .where(eq(s.imports.id, id));
    const from = "2026-10-05T09:30:00-04:00",
      to = "2026-10-05T11:30:00-04:00";
    const plan = await cleanupPreview(db, from, to);
    expect(plan.totals).toMatchObject({
      imports: 1,
      emails: 1,
      responses: 1,
      shared: 1,
    });
    await expect(cleanupCommit(db, from, to, plan.token, "")).rejects.toThrow(
      "confirmar",
    );
    expect((await metrics(db, {})).answered).toBe(1);
    await cleanupCommit(db, from, to, plan.token, "ELIMINAR");
    expect(await metrics(db, {})).toMatchObject({
      received: 2,
      answered: 0,
      responses: 0,
    });
    expect(await db.select().from(s.imports)).toHaveLength(2);
    expect(await db.select().from(s.settings)).toHaveLength(1);
    expect(await db.select().from(s.agents)).toHaveLength(2);
  });
  it("limpieza rechaza una previsualización obsoleta", async () => {
    const id = await create();
    await stage(id, [await requestMail()]);
    const from = "2000-01-01T00:00:00Z",
      to = "2100-01-01T00:00:00Z",
      plan = await cleanupPreview(db, from, to);
    await approve(db, id, "all", "reviewer");
    await expect(
      cleanupCommit(db, from, to, plan.token, "ELIMINAR"),
    ).rejects.toThrow("cambiaron");
    expect((await metrics(db, {})).received).toBe(1);
  });
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
      average: 32400,
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
  it("aprobación de respuesta incorpora automáticamente el original pendiente", async () => {
    const id = await create();
    const response = await responseMail();
    await stage(id, [await requestMail(), response]);
    const [r] = await db
      .select()
      .from(s.stagedEmails)
      .where(eq(s.stagedEmails.key, response.key));
    expect(await approve(db, id, [r.id], "reviewer")).toBe(2);
    expect(await db.select().from(s.emails)).toHaveLength(2);
    expect(await db.select().from(s.emailImports)).toHaveLength(2);
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
      average: 32400,
      responses: 2,
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
