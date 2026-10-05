import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { emailSchema, decisionSchema } from "@/lib/validation/email";
import { DomainError, lock, rebuild } from "@/lib/imports/service";
const uuid = z.uuid(),
  dt = z.iso.datetime({ offset: true }),
  key = z.string().regex(/^[a-f0-9]{64}$/);
const tables = {
  agents: s.agents,
  settings: s.settings,
  imports: s.imports,
  emails: s.emails,
  emailImports: s.emailImports,
  stagedEmails: s.stagedEmails,
  importEntries: s.importEntries,
};
export type BackupTable = keyof typeof tables;
const mailFields = {
  key,
  data: emailSchema,
  staffName: z.string().max(200).nullable(),
  addressed: z.boolean(),
  decision: decisionSchema.nullable(),
};
const validators = {
  agents: z.object({
    id: uuid,
    name: z.string().min(1).max(200),
    email: z.email(),
    active: z.boolean(),
  }),
  settings: z.object({ id: z.literal(1), mailbox: z.email() }),
  imports: z.object({
    id: uuid,
    filename: z.string().max(2000),
    size: z.number().int().nonnegative(),
    fingerprint: key,
    status: z.enum([
      "PROCESSING",
      "PARTIAL",
      "READY_FOR_REVIEW",
      "PARTIALLY_APPROVED",
      "APPROVED",
      "DISCARDED",
      "ERROR",
      "REVERTED",
    ]),
    total: z.number().int().nonnegative(),
    createdAt: dt,
    updatedAt: dt,
    createdBy: z.string().max(320),
    approvedBy: z.string().max(320).nullable(),
    approvedAt: dt.nullable(),
  }),
  emails: z.object({
    ...mailFields,
    messageId: z.string().nullable(),
    date: dt,
    kind: z.enum(["REQUEST", "RESPONSE", "STAFF_SENT", "FOLLOWUP", "REVIEW"]),
    rootKey: key.nullable(),
    searchText: z.string().max(1100000),
  }),
  emailImports: z.object({ importId: uuid, emailKey: key }),
  stagedEmails: z.object({
    ...mailFields,
    id: uuid,
    importId: uuid,
    sourceFile: z.string().max(2000),
    state: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  }),
  importEntries: z.object({
    importId: uuid,
    sourceFile: z.string().max(2000),
    error: z.string().max(4000).nullable(),
  }),
};
export async function* backupLines(db: Database) {
  yield JSON.stringify({
    format: "atencion-backup",
    version: 1,
    createdAt: new Date().toISOString(),
  }) + "\n";
  const counts: Record<string, number> = {};
  for (const name of Object.keys(tables) as BackupTable[]) {
    let offset = 0;
    counts[name] = 0;
    while (true) {
      const rows = await db
        .select()
        .from(tables[name])
        .orderBy(sql`1`)
        .limit(100)
        .offset(offset);
      for (const data of rows) {
        counts[name]++;
        yield JSON.stringify({ table: name, data }) + "\n";
      }
      if (rows.length < 100) break;
      offset += 100;
    }
  }
  yield JSON.stringify({ end: true, counts }) + "\n";
}
export async function checkJob(db: Database, id: string, userId: string) {
  const [job] = await db
    .select()
    .from(s.restoreJobs)
    .where(and(eq(s.restoreJobs.id, id), eq(s.restoreJobs.userId, userId)));
  if (!job || job.completed)
    throw new DomainError("Restauración no disponible");
  return job;
}
export async function stageRestore(
  db: Database,
  id: string,
  userId: string,
  rows: { line: number; table: BackupTable; data: unknown }[],
) {
  await db.transaction(async (tx) => {
    await lock(tx);
    const job = await checkJob(tx, id, userId);
    if (job.ready)
      throw new DomainError("El respaldo ya está listo para confirmar");
    for (const row of rows) {
      const data = validators[row.table].parse(row.data);
      await tx
        .insert(s.restoreRows)
        .values({ jobId: id, line: row.line, table: row.table, data })
        .onConflictDoUpdate({
          target: [s.restoreRows.jobId, s.restoreRows.line],
          set: { table: row.table, data },
        });
    }
  });
}
export async function restoreSummary(db: Database, id: string, userId: string) {
  await checkJob(db, id, userId);
  const result = await db.execute(
    sql`select "table",count(*)::int as count from restore_rows where "jobId"=${id} group by "table"`,
  );
  return Object.fromEntries(
    result.rows.map((r) => [r.table, Number(r.count)]),
  ) as Record<string, number>;
}
export async function finishRestore(
  db: Database,
  id: string,
  userId: string,
  counts: Record<string, number>,
) {
  return db.transaction(async (tx) => {
    await lock(tx);
    const actual = await restoreSummary(tx, id, userId);
    for (const name of Object.keys(tables))
      if ((actual[name] ?? 0) !== counts[name])
        throw new DomainError("Respaldo incompleto: los totales no coinciden");
    if (actual.settings !== 1)
      throw new DomainError("Falta la configuración del buzón");
    await tx
      .update(s.restoreJobs)
      .set({ ready: true })
      .where(eq(s.restoreJobs.id, id));
    return actual;
  });
}
export async function commitRestore(db: Database, id: string, userId: string) {
  await db.transaction(async (tx) => {
    await lock(tx);
    const job = await checkJob(tx, id, userId);
    if (!job.ready)
      throw new DomainError("Valida el respaldo antes de restaurar");
    await tx.delete(s.conversations);
    await tx.delete(s.emailImports);
    await tx.delete(s.stagedEmails);
    await tx.delete(s.importEntries);
    await tx.delete(s.emails);
    await tx.delete(s.imports);
    await tx.delete(s.agents);
    await tx.delete(s.settings);
    for (const name of Object.keys(tables) as BackupTable[]) {
      let offset = 0;
      while (true) {
        const rows = await tx
          .select()
          .from(s.restoreRows)
          .where(
            and(eq(s.restoreRows.jobId, id), eq(s.restoreRows.table, name)),
          )
          .orderBy(asc(s.restoreRows.line))
          .limit(100)
          .offset(offset);
        for (const row of rows) {
          const data = validators[name].parse(row.data);
          // A closed map of table names + server-validated data; no user-controlled SQL identifiers.
          if (name === "agents")
            await tx.insert(s.agents).values(validators.agents.parse(data));
          if (name === "settings")
            await tx.insert(s.settings).values(validators.settings.parse(data));
          if (name === "imports") {
            const v = validators.imports.parse(data);
            await tx.insert(s.imports).values({
              ...v,
              createdAt: new Date(v.createdAt),
              updatedAt: new Date(v.updatedAt),
              approvedAt: v.approvedAt ? new Date(v.approvedAt) : null,
              status: v.status === "PROCESSING" ? "PARTIAL" : v.status,
            });
          }
          if (name === "emails") {
            const v = validators.emails.parse(data);
            if (v.key !== v.data.key)
              throw new DomainError("Identificador de correo inconsistente");
            await tx.insert(s.emails).values({
              ...v,
              date: new Date(v.date),
              searchText: [
                v.data.from.name,
                v.data.from.address,
                v.data.subject,
                v.data.bodyText,
                v.staffName,
              ].join(" "),
            });
          }
          if (name === "emailImports")
            await tx
              .insert(s.emailImports)
              .values(validators.emailImports.parse(data));
          if (name === "stagedEmails")
            await tx
              .insert(s.stagedEmails)
              .values(validators.stagedEmails.parse(data));
          if (name === "importEntries")
            await tx
              .insert(s.importEntries)
              .values(validators.importEntries.parse(data));
        }
        if (rows.length < 100) break;
        offset += 100;
      }
    }
    const orphan = await tx.execute(
      sql`select 1 from emails e where not exists(select 1 from email_imports p where p."emailKey"=e.key) limit 1`,
    );
    if (orphan.rows.length)
      throw new DomainError("Respaldo inválido: correos sin procedencia");
    await rebuild(tx);
    await tx
      .update(s.restoreJobs)
      .set({ completed: true })
      .where(eq(s.restoreJobs.id, id));
    await tx.delete(s.restoreRows).where(eq(s.restoreRows.jobId, id));
  });
}
