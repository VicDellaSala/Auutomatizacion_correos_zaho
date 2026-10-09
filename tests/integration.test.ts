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
import { editApproved, correctionVersion } from "../src/lib/emails/service";
import type { Decision } from "../src/types/email";
import { attentionState } from "../src/lib/metrics/attention";
import { ignoredPercentage } from "../src/lib/metrics/activity";
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
  async function edit(key: string, decision: Decision) {
    const [row] = await db.select().from(s.emails).where(eq(s.emails.key, key));
    return editApproved(db, key, decision, correctionVersion(row), {
      id: "test-auditor",
      name: "Revisor",
    });
  }
  it("personal actual: Yessika con Re y original ausente pasa a iniciado sin reimportar", async () => {
    const id = await create(),
      mail = await responseMail("report@test", "missing@test");
    mail.from = {
      name: "Yessika",
      address: "yessika.salcedo@credicard.com.ve",
    };
    await stage(id, [mail]);
    expect((await preview(db, id)).counts.REVIEW).toBe(1);
    await db
      .insert(s.agents)
      .values({ name: "Yessika Salcedo", email: mail.from.address });
    expect((await preview(db, id)).counts).toMatchObject({
      REVIEW: 0,
      STAFF_SENT: 1,
    });
    expect((await metrics(db, {})).received).toBe(0);
  });
  it.each(["Yessika", "Rubén", "Geraldine", "Lyliana", "Julia"])(
    "%s: personal configurado sin original no requiere revisión",
    async (name) => {
      const email = `agent-${name.length}@example.test`;
      await db.insert(s.agents).values({ name, email });
      const id = await create(),
        mail = await responseMail("staff-report@test", "missing@test");
      mail.from = { name, address: email };
      await stage(id, [mail]);
      expect((await preview(db, id)).counts).toMatchObject({
        STAFF_SENT: 1,
        REVIEW: 0,
      });
    },
  );
  it("reasociar una respuesta excluida manualmente actualiza solicitud y audita ambos registros", async () => {
    const id = await create(),
      a = await requestMail(),
      b = await responseMail();
    await stage(id, [a, b]);
    await approve(db, id, "all", "reviewer");
    await edit(a.key, { kind: "REQUEST", requestStatus: "UNANSWERED" });
    expect((await metrics(db, {})).unanswered).toBe(1);
    await edit(b.key, { kind: "RESPONSE", targetKey: a.key });
    expect(await metrics(db, {})).toMatchObject({
      answered: 1,
      unanswered: 0,
      responses: 1,
    });
    const [root] = await db
      .select()
      .from(s.emails)
      .where(eq(s.emails.key, a.key));
    expect(root.decision?.excludedResponseKeys).toEqual([]);
    expect(root.decision?.audit).toHaveLength(2);
  });
  it("ignorar desde staging conserva el mensaje, sin incorporarlo a métricas", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a]);
    const [row] = await db.select().from(s.stagedEmails);
    await decide(db, id, row.id, {
      kind: "REQUEST",
      ignored: true,
      ignoredReason: "Prueba sintética",
    });
    expect((await preview(db, id)).counts.IGNORED).toBe(1);
    await approve(db, id, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      received: 0,
      ignored: 1,
      evaluated: 0,
    });
    expect(
      (await mailList(db, { view: "ignored" })).rows[0].data.bodyText,
    ).toBe(a.bodyText);
  });
  it("Rubén asocia Respuesta de cambio de plan con solicitud de días anteriores del histórico completo", async () => {
    await db
      .insert(s.agents)
      .values({ name: "Rubén Castro", email: "ruben.castro@credicard.com.ve" });
    const first = await create(),
      a = await parseEmail(
        eml({
          id: "old-plan@test",
          subject: "Solicitud de cambio de plan",
          date: "Tue, 01 Sep 2026 14:00:00 -0400",
        }),
      );
    await stage(first, [a]);
    await approve(db, first, "all", "reviewer");
    const next = await create(),
      b = await parseEmail(
        eml({
          id: "new-plan@test",
          from: "ruben.castro@credicard.com.ve",
          subject: "Respuesta de cambio de plan",
          date: "Mon, 05 Oct 2026 10:04:00 -0400",
          headers: "Cc: customer@example.test\r\n",
        }),
      );
    await stage(next, [b]);
    expect((await preview(db, next)).matches.get(b.key)).toMatchObject({
      kind: "RESPONSE",
      rootKey: a.key,
    });
    expect((await metrics(db, {})).unanswered).toBe(1);
    await approve(db, next, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      answered: 1,
      unanswered: 0,
      responses: 1,
      team: [{ name: "Rubén Castro", responses: 1 }],
    });
  });
  it("16:55 queda pendiente indefinidamente, fuera de tasa; al aprobar respuesta pasa a respondida", async () => {
    const first = await create(),
      a = await parseEmail(eml({ date: "Sat, 03 Oct 2026 16:55:00 -0400" }));
    await stage(first, [a]);
    expect(await preview(db, first)).toMatchObject({
      afterHours: 1,
      unanswered: 0,
    });
    await approve(db, first, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      received: 1,
      afterHours: 1,
      answered: 0,
      unanswered: 0,
      evaluated: 0,
    });
    expect((await mailList(db, { view: "after-hours" })).count).toBe(1);
    expect((await mailList(db, { view: "unanswered" })).count).toBe(0);
    const second = await create();
    await stage(second, [
      await responseMail(
        "next@test",
        "request@test",
        "Sun, 04 Oct 2026 08:01:00 -0400",
      ),
    ]);
    expect((await metrics(db, {})).afterHours).toBe(1);
    await approve(db, second, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      afterHours: 0,
      answered: 1,
      rate: 100,
      average: 360,
    });
    expect((await mailList(db, { view: "after-hours" })).count).toBe(0);
  });
  it("ignorar solicitud respondida excluye tiempos, respuestas y tasa; restaurar recupera métricas", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a, await responseMail()]);
    await approve(db, id, "all", "reviewer");
    await edit(a.key, {
      kind: "REQUEST",
      ignored: true,
      ignoredReason: "Reporte informativo",
    });
    expect(await metrics(db, {})).toMatchObject({
      received: 0,
      answered: 0,
      unanswered: 0,
      rate: 0,
      average: 0,
      responses: 0,
      ignored: 1,
    });
    expect((await mailList(db, { view: "ignored" })).count).toBe(1);
    expect((await mailList(db, { view: "answered" })).count).toBe(0);
    await edit(a.key, { kind: "REQUEST", ignored: false });
    expect(await metrics(db, {})).toMatchObject({
      received: 1,
      answered: 1,
      responses: 1,
    });
    const [row] = await db
      .select()
      .from(s.emails)
      .where(eq(s.emails.key, a.key));
    expect(row.decision?.audit).toHaveLength(2);
    expect(row.decision?.audit?.[0]).toMatchObject({
      userId: "test-auditor",
      before: { decision: null },
      after: { decision: { ignored: true } },
    });
  });
  it("no respondida a ignorada y respuesta manual sin email ficticio son auditables", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a]);
    await approve(db, id, "all", "reviewer");
    await edit(a.key, { kind: "REQUEST", ignored: true });
    expect((await metrics(db, {})).unanswered).toBe(0);
    await edit(a.key, {
      kind: "REQUEST",
      ignored: false,
      requestStatus: "ANSWERED",
    });
    expect(await metrics(db, {})).toMatchObject({
      received: 1,
      answered: 1,
      responses: 1,
      average: 0,
      rate: 100,
    });
    expect(await db.select().from(s.emails)).toHaveLength(1);
    expect(
      (await mailList(db, { view: "answered" })).rows[0].decision
        ?.requestStatus,
    ).toBe("ANSWERED");
    await edit(a.key, { kind: "REQUEST", requestStatus: "UNANSWERED" });
    expect((await metrics(db, {})).unanswered).toBe(1);
  });
  it.each(["Geraldine", "Victor"])(
    "acredita respuesta manual a %s por ID y usa su nombre oficial",
    async (name) => {
      const [agent] = await db
        .insert(s.agents)
        .values({ name, email: `${name.toLowerCase()}@example.test` })
        .returning();
      const id = await create(),
        a = await requestMail();
      await stage(id, [a]);
      await approve(db, id, "all", "reviewer");
      await edit(a.key, {
        kind: "REQUEST",
        requestStatus: "ANSWERED",
        responsibleId: agent.id,
      });
      expect(await metrics(db, {})).toMatchObject({
        answered: 1,
        responses: 1,
        manualResponses: 1,
        sent: 1,
        team: [{ personId: agent.id, name, responses: 1, average: null }],
      });
      const list = await mailList(db, {
        view: "responses",
        personId: agent.id,
      });
      expect(list.count).toBe(1);
      expect(list.rows[0]).toMatchObject({
        manualCredit: true,
        responder: name,
        responseSeconds: null,
      });
      await db
        .update(s.agents)
        .set({ name: `${name} oficial` })
        .where(eq(s.agents.id, agent.id));
      expect((await metrics(db, {})).team[0].name).toBe(`${name} oficial`);
    },
  );
  it("sin responsable acredita Sin asignar y conserva fecha al asignarlo después", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a]);
    await approve(db, id, "all", "reviewer");
    await edit(a.key, { kind: "REQUEST", requestStatus: "ANSWERED" });
    expect(await metrics(db, {})).toMatchObject({
      answered: 1,
      responses: 1,
      team: [{ personId: "unassigned", name: "Sin asignar", responses: 1 }],
    });
    const before = (await mailList(db, { view: "responses" })).rows[0]
      .activityDate;
    const [agent] = await db
      .select()
      .from(s.agents)
      .where(eq(s.agents.email, staff));
    await edit(a.key, {
      kind: "REQUEST",
      requestStatus: "ANSWERED",
      responsibleId: agent.id,
    });
    expect(
      (await mailList(db, { view: "responses" })).rows[0].activityDate,
    ).toEqual(before);
  });
  it("email real sustituye manual del mismo agente y segunda respuesta sí suma", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a]);
    await approve(db, id, "all", "reviewer");
    const [agent] = await db
      .select()
      .from(s.agents)
      .where(eq(s.agents.email, staff));
    await edit(a.key, {
      kind: "REQUEST",
      requestStatus: "ANSWERED",
      responsibleId: agent.id,
    });
    const next = await create();
    await stage(next, [await responseMail()]);
    await approve(db, next, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      answered: 1,
      responses: 1,
      manualResponses: 0,
    });
    const third = await create();
    await stage(third, [
      await responseMail(
        "additional@test",
        "request@test",
        "Sun, 04 Oct 2026 09:01:00 -0400",
      ),
    ]);
    await approve(db, third, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      answered: 1,
      responses: 2,
      manualResponses: 0,
    });
  });
  it("atención manual distinta explícita se conserva como adicional al email real", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a, await responseMail()]);
    await approve(db, id, "all", "reviewer");
    const [agent] = await db
      .select()
      .from(s.agents)
      .where(eq(s.agents.email, staff));
    await edit(a.key, {
      kind: "REQUEST",
      requestStatus: "ANSWERED",
      responsibleId: agent.id,
      manualResponseAdditional: true,
    });
    expect(await metrics(db, {})).toMatchObject({
      answered: 1,
      responses: 2,
      manualResponses: 1,
    });
    expect((await mailList(db, { view: "responses" })).count).toBe(2);
  });
  it("respuesta de otra persona no absorbe una gestión manual atribuida", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a, await responseMail()]);
    await approve(db, id, "all", "reviewer");
    const [agent] = await db
      .insert(s.agents)
      .values({ name: "Victor", email: "victor@example.test" })
      .returning();
    await edit(a.key, {
      kind: "REQUEST",
      requestStatus: "ANSWERED",
      responsibleId: agent.id,
    });
    expect(await metrics(db, {})).toMatchObject({
      responses: 2,
      manualResponses: 1,
    });
  });
  it("diez respuestas y cinco iniciados suman quince gestiones sin usar solicitudes", async () => {
    const id = await create(),
      mails = [];
    for (let i = 0; i < 10; i++)
      mails.push(await requestMail(`manual-${i}@test`));
    for (let i = 0; i < 5; i++)
      mails.push(
        await parseEmail(
          eml({ id: `sent-${i}@test`, from: staff, subject: `Reporte ${i}` }),
        ),
      );
    await stage(id, mails);
    await approve(db, id, "all", "reviewer");
    const [agent] = await db
      .select()
      .from(s.agents)
      .where(eq(s.agents.email, staff));
    for (const a of mails.slice(0, 10))
      await edit(a.key, {
        kind: "REQUEST",
        requestStatus: "ANSWERED",
        responsibleId: agent.id,
      });
    const m = await metrics(db, {});
    expect(m).toMatchObject({
      responses: 10,
      initiatedTotal: 5,
      sent: 15,
      activities: [
        { personId: agent.id, responses: 10, initiated: 5, total: 15 },
      ],
    });
    expect(m.activities.reduce((n, p) => n + p.total, 0)).toBe(
      m.responses + m.initiatedTotal,
    );
  });
  it("fecha manual existente viene de auditoría y no de recepción ni última corrección", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a]);
    await approve(db, id, "all", "reviewer");
    await edit(a.key, { kind: "REQUEST", requestStatus: "ANSWERED" });
    const [row] = await db
      .select()
      .from(s.emails)
      .where(eq(s.emails.key, a.key));
    const decision = { ...row.decision! };
    delete decision.manualAnsweredAt;
    decision.audit![0].at = "2026-10-06T15:00:00Z";
    await db.update(s.emails).set({ decision }).where(eq(s.emails.key, a.key));
    await edit(a.key, {
      kind: "REQUEST",
      requestStatus: "ANSWERED",
      ignoredReason: "Cambio de nota",
    });
    expect(
      (await metrics(db, { from: "2026-10-06", to: "2026-10-06" })).responses,
    ).toBe(1);
    expect(
      (await metrics(db, { from: "2026-10-03", to: "2026-10-03" })).responses,
    ).toBe(0);
    expect(
      (
        await mailList(db, {
          view: "responses",
          from: "2026-10-06",
          to: "2026-10-06",
        })
      ).count,
    ).toBe(1);
  });
  it("actividad real se filtra por envío y solicitudes por recepción", async () => {
    const id = await create();
    await stage(id, [await requestMail(), await responseMail()]);
    await approve(db, id, "all", "reviewer");
    expect(
      await metrics(db, { from: "2026-10-03", to: "2026-10-03" }),
    ).toMatchObject({ received: 1, answered: 1, responses: 0, sent: 0 });
    expect(
      await metrics(db, { from: "2026-10-04", to: "2026-10-04" }),
    ).toMatchObject({ received: 0, responses: 1, sent: 1 });
    expect(
      (
        await mailList(db, {
          view: "responses",
          from: "2026-10-04",
          to: "2026-10-04",
        })
      ).count,
    ).toBe(1);
  });
  it("ignorar crédito manual lo excluye y restaura; porcentaje informativo sin división por cero", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a]);
    await approve(db, id, "all", "reviewer");
    await edit(a.key, {
      kind: "REQUEST",
      requestStatus: "ANSWERED",
      ignored: true,
    });
    expect(await metrics(db, {})).toMatchObject({
      received: 0,
      answered: 0,
      responses: 0,
      sent: 0,
      ignored: 1,
      average: 0,
    });
    await edit(a.key, {
      kind: "REQUEST",
      requestStatus: "ANSWERED",
      ignored: false,
    });
    expect((await metrics(db, {})).responses).toBe(1);
    expect(ignoredPercentage(51, 105).toFixed(1)).toBe("48.6");
    expect(ignoredPercentage(51, 0)).toBe(0);
  });
  it("respuesta manual sin asociación se aprueba, cuenta por persona y encuentra original futuro", async () => {
    const id = await create(),
      b = await responseMail();
    await stage(id, [b]);
    const [row] = await db.select().from(s.stagedEmails);
    await decide(db, id, row.id, { kind: "RESPONSE" });
    expect((await preview(db, id)).matches.get(b.key)).toMatchObject({
      kind: "RESPONSE",
      rootKey: null,
    });
    await approve(db, id, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      received: 0,
      answered: 0,
      responses: 1,
      team: [{ responses: 1, requests: 0, unassociated: 1, average: null }],
    });
    expect(
      (await mailList(db, { view: "responses" })).rows[0].rootKey,
    ).toBeNull();
    const next = await create();
    await stage(next, [await requestMail()]);
    expect((await metrics(db, {})).answered).toBe(0);
    await approve(db, next, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      received: 1,
      answered: 1,
      responses: 1,
      team: [{ requests: 1, unassociated: 0 }],
    });
  });
  it("editar aprobado permite relacionar una respuesta y modificar responsable", async () => {
    const id = await create(),
      a = await requestMail(),
      b = await responseMail();
    b.inReplyTo = [];
    b.references = [];
    b.subject = "Otro asunto sin relación";
    await stage(id, [a, b]);
    await approve(db, id, "all", "reviewer");
    const [agent] = await db
      .insert(s.agents)
      .values({
        name: "Responsable corregido",
        email: "correction@example.test",
      })
      .returning();
    await edit(b.key, {
      kind: "RESPONSE",
      targetKey: a.key,
      responsibleId: agent.id,
    });
    expect(await metrics(db, {})).toMatchObject({
      answered: 1,
      responses: 1,
      team: [{ name: "Responsable corregido" }],
    });
    expect(
      (await db.select().from(s.emails).where(eq(s.emails.key, b.key)))[0]
        .decision?.audit,
    ).toHaveLength(1);
  });
  it("ignorar una respuesta selecciona la siguiente primera respuesta válida", async () => {
    const id = await create(),
      a = await requestMail(),
      b = await responseMail(),
      c = await responseMail(
        "later@test",
        "request@test",
        "Sun, 04 Oct 2026 09:01:00 -0400",
      );
    await stage(id, [a, b, c]);
    await approve(db, id, "all", "reviewer");
    await edit(b.key, { kind: "RESPONSE", targetKey: a.key, ignored: true });
    expect(await metrics(db, {})).toMatchObject({
      answered: 1,
      responses: 1,
      average: 32460,
    });
    expect((await db.select().from(s.conversations))[0].firstResponseKey).toBe(
      c.key,
    );
  });
  it("rechaza edición obsoleta y auditoría inyectada", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a]);
    await approve(db, id, "all", "reviewer");
    const [row] = await db.select().from(s.emails);
    await edit(a.key, {
      kind: "REQUEST",
      requestStatus: "ANSWERED",
      audit: [
        {
          at: "2026-01-01T00:00:00Z",
          userId: "fake",
          userName: "fake",
          before: {
            kind: "REQUEST",
            rootKey: null,
            staffName: null,
            decision: null,
          },
          after: {
            kind: "REQUEST",
            rootKey: null,
            staffName: null,
            decision: null,
          },
        },
      ],
    });
    await expect(
      editApproved(db, a.key, { kind: "REQUEST" }, correctionVersion(row), {
        id: "test",
        name: "test",
      }),
    ).rejects.toThrow("cambió");
    const [updated] = await db.select().from(s.emails);
    expect(updated.decision?.audit).toHaveLength(1);
    expect(updated.decision?.audit?.[0].userId).toBe("test-auditor");
  });
  it.each([
    ["16:49", "UNANSWERED"],
    ["16:50", "AFTER_HOURS"],
    ["16:58", "AFTER_HOURS"],
    ["18:00", "AFTER_HOURS"],
  ])("umbral exacto %s en Caracas", async (time, state) => {
    expect(
      attentionState(
        { kind: "REQUEST", date: `2026-10-01T${time}:00-04:00` },
        null,
      ),
    ).toBe(state);
    const id = await create(),
      a = await parseEmail(eml({ date: `Thu, 01 Oct 2026 ${time}:00 -0400` }));
    await stage(id, [a]);
    await approve(db, id, "all", "reviewer");
    expect((await mailList(db, {})).rows[0].attention).toBe(state);
  });
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
    await db
      .update(s.stagedEmails)
      .set({ decision: { kind: "RESPONSE", targetKey: mail.key } });
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

  it("nombres históricos y actuales del mismo remitente se agrupan por ID", async () => {
    const id = await create(),
      a = await requestMail(),
      b = await responseMail();
    await stage(id, [a, b]);
    await approve(db, id, "all", "reviewer");
    const [agent] = await db
      .select()
      .from(s.agents)
      .where(eq(s.agents.email, staff));
    await db
      .update(s.emails)
      .set({ staffName: "Nombre histórico distinto" })
      .where(eq(s.emails.key, b.key));
    await db
      .update(s.agents)
      .set({ name: "Nombre oficial" })
      .where(eq(s.agents.id, agent.id));
    const next = await create(),
      sent = await parseEmail(
        eml({ from: staff, id: "alias-sent@test", subject: "Informe nuevo" }),
      );
    await stage(next, [sent]);
    await approve(db, next, "all", "reviewer");
    expect((await metrics(db, {})).activities).toMatchObject([
      {
        personId: agent.id,
        name: "Nombre oficial",
        responses: 1,
        initiated: 1,
        total: 2,
      },
    ]);
    expect(
      (await mailList(db, { view: "staff-sent", personId: agent.id })).count,
    ).toBe(1);
  });
  it("manual antiguo sin fecha usa incorporación explícitamente identificada", async () => {
    const id = await create(),
      a = await requestMail();
    await stage(id, [a]);
    await approve(db, id, "all", "reviewer");
    await db
      .update(s.emails)
      .set({ decision: { kind: "REQUEST", requestStatus: "ANSWERED" } })
      .where(eq(s.emails.key, a.key));
    await db
      .update(s.imports)
      .set({ approvedAt: new Date("2026-10-06T14:00:00Z") })
      .where(eq(s.imports.id, id));
    expect(
      await metrics(db, { from: "2026-10-06", to: "2026-10-06" }),
    ).toMatchObject({ manualResponses: 1, manualDateEstimated: 1 });
    expect((await mailList(db, { view: "responses" })).rows[0]).toMatchObject({
      manualCredit: true,
      dateEstimated: true,
    });
  });
  it("un correo real reemplaza crédito sin asignar; ignorar ese correo recupera el crédito", async () => {
    const id = await create(),
      a = await requestMail(),
      b = await responseMail();
    await stage(id, [a]);
    await approve(db, id, "all", "reviewer");
    await edit(a.key, { kind: "REQUEST", requestStatus: "ANSWERED" });
    const next = await create();
    await stage(next, [b]);
    await approve(db, next, "all", "reviewer");
    expect(await metrics(db, {})).toMatchObject({
      responses: 1,
      manualResponses: 0,
    });
    await edit(b.key, { kind: "RESPONSE", targetKey: a.key, ignored: true });
    expect(await metrics(db, {})).toMatchObject({
      responses: 1,
      manualResponses: 1,
      team: [{ name: "Sin asignar" }],
    });
  });
  it("respaldo valida cantidades y restaura transaccionalmente sin tocar usuarios", async () => {
    const id = await create();
    await stage(id, [await requestMail(), await responseMail()]);
    await approve(db, id, "all", "reviewer");
    const original = await requestMail();
    await edit(original.key, {
      kind: "REQUEST",
      requestStatus: "ANSWERED",
      manualResponseAdditional: true,
    });
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
    expect(await metrics(db, {})).toMatchObject({
      responses: 2,
      manualResponses: 1,
    });
    expect(
      (
        await db.select().from(s.emails).where(eq(s.emails.key, original.key))
      )[0].decision?.audit,
    ).toHaveLength(1);
    expect(await db.select().from(s.users)).toHaveLength(1);
  });
});
