import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { matchEmails } from "@/lib/matching/matcher";
import { refreshPendingStaff, ensureJulia } from "./staff";
import { businessTimeSql } from "@/lib/metrics/business-time";
import { emailSchema } from "@/lib/validation/email";
import { normalizeSubject, sha256 } from "@/lib/email/normalize";
import { contentParts } from "@/lib/email/content-cleaner";
import type {
  Decision,
  EmailData,
  MatchMail,
  ImportStatus,
} from "@/types/email";
export class DomainError extends Error {
  constructor(
    message: string,
    public issues: { id: string; subject: string; reason: string }[] = [],
  ) {
    super(message);
  }
}
export async function lock(db: Database) {
  await db.execute(sql`select pg_advisory_xact_lock(81742026)`);
}
export async function getImport(db: Database, id: string) {
  const [row] = await db.select().from(s.imports).where(eq(s.imports.id, id));
  if (!row) throw new DomainError("Importación no encontrada");
  return row;
}
const closed: ImportStatus[] = ["DISCARDED", "REVERTED", "APPROVED"];
export async function ingestBatch(
  db: Database,
  id: string,
  entries: { sourceFile: string; data?: EmailData; error?: string }[],
  total: number,
) {
  return db.transaction(async (tx) => {
    await lock(tx);
    const imp = await getImport(tx, id);
    if (closed.includes(imp.status))
      throw new DomainError("Esta importación ya está cerrada");
    await ensureJulia(tx);
    const [config] = await tx.select().from(s.settings);
    if (!config) throw new DomainError("Ejecuta las migraciones iniciales");
    const staff = await tx
      .select()
      .from(s.agents)
      .where(eq(s.agents.active, true));
    const staged: (typeof s.stagedEmails.$inferInsert)[] = [];
    const outcomes = new Map<string, typeof s.importEntries.$inferInsert>();
    for (const entry of entries) {
      if (entry.data) {
        const data = emailSchema.parse(entry.data);
        data.normalizedSubject = normalizeSubject(data.subject);
        Object.assign(data, contentParts(data.bodyText));
        const canonical = (a: EmailData["to"]) =>
          a.map((v) => v.address.toLowerCase()).sort();
        data.from.address = data.from.address.toLowerCase();
        for (const a of [...data.to, ...data.cc, ...data.replyTo])
          a.address = a.address.toLowerCase();
        data.key = await sha256(
          data.messageId
            ? `id:${data.messageId}`
            : JSON.stringify([
                data.from.address,
                canonical(data.to),
                canonical(data.cc),
                new Date(data.date).toISOString(),
                data.subject,
                data.bodyText,
              ]),
        );
        staged.push({
          importId: id,
          sourceFile: entry.sourceFile,
          key: data.key,
          data,
          staffName:
            staff.find((a) => a.email === data.from.address)?.name ?? null,
          addressed: [...data.to, ...data.cc].some(
            (a) => a.address === config.mailbox,
          ),
        });
      }
      outcomes.set(entry.sourceFile, {
        importId: id,
        sourceFile: entry.sourceFile,
        error: entry.error ?? null,
      });
    }
    if (staged.length)
      await tx.insert(s.stagedEmails).values(staged).onConflictDoNothing();
    if (outcomes.size)
      await tx
        .insert(s.importEntries)
        .values([...outcomes.values()])
        .onConflictDoUpdate({
          target: [s.importEntries.importId, s.importEntries.sourceFile],
          set: { error: sql`excluded.error` },
        });
    await tx
      .update(s.imports)
      .set({ total, updatedAt: new Date() })
      .where(eq(s.imports.id, id));
  });
}
// Metadata only: historical message bodies are never loaded just to build relationships.
export async function metadata(
  db: Database,
  importId?: string,
): Promise<MatchMail[]> {
  const official =
    await db.execute(sql`select key, data->>'messageId' as "messageId", data->'inReplyTo' as "inReplyTo", data->'references' as "references",
    data->>'date' as date, data->'from' as "from", data->'to' as "to", data->'cc' as cc, data->>'subject' as subject,
    data->>'normalizedSubject' as "normalizedSubject", "staffName", addressed, decision, kind as "approvedKind", "rootKey" as "approvedRootKey" from emails`);
  const result = official.rows as unknown as MatchMail[];
  if (importId) {
    const pending =
      await db.execute(sql`select key, data->>'messageId' as "messageId", data->'inReplyTo' as "inReplyTo", data->'references' as "references",
      data->>'date' as date, data->'from' as "from", data->'to' as "to", data->'cc' as cc, data->>'subject' as subject,
      data->>'normalizedSubject' as "normalizedSubject", "staffName", addressed, decision from staged_emails where "importId" = ${importId} and state = 'PENDING'`);
    const known = new Set(result.map((m) => m.key));
    result.push(
      ...(pending.rows as unknown as MatchMail[]).filter(
        (m) => !known.has(m.key),
      ),
    );
  }
  return result;
}
export async function rebuild(db: Database) {
  const mails = await metadata(db);
  const matches = matchEmails(mails);
  const existing = await db
    .select({
      key: s.emails.key,
      kind: s.emails.kind,
      rootKey: s.emails.rootKey,
    })
    .from(s.emails);
  for (const row of existing) {
    const next = matches.get(row.key)!;
    // Retain the previously approved target when cleanup removes it. Later
    // rebuilds must not silently assign this response to a different request.
    const rootKey =
      next.rootKey ?? (next.kind === "REVIEW" ? row.rootKey : null);
    if (next.kind !== row.kind || rootKey !== row.rootKey)
      await db
        .update(s.emails)
        .set({ kind: next.kind, rootKey })
        .where(eq(s.emails.key, row.key));
  }
  await db.delete(s.conversations);
  await db.execute(sql`insert into conversations ("rootKey", "firstResponseKey", "firstResponseAt", "responseSeconds", "responseCount")
    select e.key, f.key, f.date, case when f.date is null then null else ${businessTimeSql(sql`e.date`, sql`f.date`)} end,
    (select count(*)::int from emails r where r."rootKey"=e.key and r.kind='RESPONSE')
    from emails e left join lateral (select r.key, r.date from emails r where r."rootKey"=e.key and r.kind='RESPONSE' order by r.date, r.key limit 1) f on true
    where e.kind in ('REQUEST','STAFF_SENT')`);
  return matches;
}
export async function preview(db: Database, id: string) {
  await db.transaction(async (tx) => {
    await lock(tx);
    await refreshPendingStaff(tx);
  });
  const matches = matchEmails(await metadata(db, id));
  const current = await db.select().from(s.conversations);
  const currentByKey = new Map(current.map((c) => [c.rootKey, c]));
  const pending = await db
    .select({
      id: s.stagedEmails.id,
      key: s.stagedEmails.key,
      state: s.stagedEmails.state,
    })
    .from(s.stagedEmails)
    .where(eq(s.stagedEmails.importId, id));
  const counts: Record<string, number> = {
    REQUEST: 0,
    RESPONSE: 0,
    STAFF_SENT: 0,
    FOLLOWUP: 0,
    REVIEW: 0,
  };
  const changes = new Set<string>();
  const existingRoots = new Set(current.map((c) => c.rootKey));
  const newRoots = new Set<string>();
  const answeredRoots = new Set(
    [...matches.values()]
      .filter((m) => m.kind === "RESPONSE")
      .map((m) => m.rootKey),
  );
  let automatic = 0;
  for (const row of pending.filter((r) => r.state === "PENDING")) {
    const match = matches.get(row.key)!;
    counts[match.kind]++;
    if (match.kind === "REQUEST" && !existingRoots.has(row.key))
      newRoots.add(row.key);
    if (match.kind !== "REVIEW" && !match.reason.includes("manual"))
      automatic++;
    if (
      match.kind === "RESPONSE" &&
      match.rootKey &&
      currentByKey.has(match.rootKey) &&
      !currentByKey.get(match.rootKey)!.firstResponseKey
    )
      changes.add(match.rootKey!);
  }
  return {
    matches,
    counts,
    changes: [...changes],
    automatic,
    answered: [...newRoots].filter((key) => answeredRoots.has(key)).length,
    unanswered: [...newRoots].filter((key) => !answeredRoots.has(key)).length,
    answeredRoots: [...answeredRoots].filter((key): key is string => !!key),
  };
}
async function refreshStatus(db: Database, id: string) {
  const rows = await db
    .select({ state: s.stagedEmails.state })
    .from(s.stagedEmails)
    .where(eq(s.stagedEmails.importId, id));
  const pending = rows.some((r) => r.state === "PENDING"),
    approved = rows.some((r) => r.state === "APPROVED");
  const imp = await getImport(db, id);
  const incomplete =
    imp.status === "PARTIAL" ||
    imp.status === "PROCESSING" ||
    imp.status === "ERROR";
  await db
    .update(s.imports)
    .set({
      status: incomplete
        ? "PARTIAL"
        : pending
          ? approved
            ? "PARTIALLY_APPROVED"
            : "READY_FOR_REVIEW"
          : "APPROVED",
      updatedAt: new Date(),
    })
    .where(eq(s.imports.id, id));
}
export async function approve(
  db: Database,
  id: string,
  ids: string[] | "all" | { conversation: string },
  user: string,
) {
  return db.transaction(async (tx) => {
    await lock(tx);
    const imp = await getImport(tx, id);
    if (closed.includes(imp.status) || imp.status === "PROCESSING")
      throw new DomainError(
        "Finaliza o pausa el procesamiento antes de aprobar",
      );
    await refreshPendingStaff(tx);
    const allMetadata = await metadata(tx, id);
    const proposed = matchEmails(allMetadata);
    const mailByKey = new Map(allMetadata.map((m) => [m.key, m]));
    const selectedIds = new Set(Array.isArray(ids) ? ids : []);
    const pending = await tx
      .select({ id: s.stagedEmails.id, key: s.stagedEmails.key })
      .from(s.stagedEmails)
      .where(
        and(
          eq(s.stagedEmails.importId, id),
          eq(s.stagedEmails.state, "PENDING"),
        ),
      );
    const selected = pending.filter(
      (r) =>
        ids === "all" ||
        (Array.isArray(ids)
          ? selectedIds.has(r.id)
          : proposed.get(r.key)?.rootKey === ids.conversation),
    );
    const selectedKeys = new Set(selected.map((r) => r.key));
    const pendingByKey = new Map(pending.map((r) => [r.key, r]));
    // Include the original and any header chain needed to reproduce this match after approval.
    for (let i = 0; i < selected.length; i++) {
      const match = proposed.get(selected[i].key);
      for (const key of [match?.rootKey, ...(match?.dependencies ?? [])]) {
        const dependency = key ? pendingByKey.get(key) : undefined;
        if (dependency && !selectedKeys.has(dependency.key)) {
          selected.push(dependency);
          selectedKeys.add(dependency.key);
        }
      }
    }
    const issues = selected
      .filter((r) => proposed.get(r.key)?.kind === "REVIEW")
      .map((r) => ({
        id: r.id,
        subject: mailByKey.get(r.key)?.subject ?? r.key,
        reason: proposed.get(r.key)!.reason,
      }));
    if (issues.length)
      throw new DomainError(
        "No se pudo aprobar. Resuelve los siguientes correos; no se incorporó ningún registro.",
        issues,
      );
    const where = and(
      eq(s.stagedEmails.importId, id),
      eq(s.stagedEmails.state, "PENDING"),
      inArray(
        s.stagedEmails.id,
        selected.map((r) => r.id),
      ),
    );
    if (!selected.length)
      throw new DomainError("No hay correos pendientes seleccionados");
    for (let offset = 0; offset < selected.length; offset += 100) {
      const batch = await tx
        .select()
        .from(s.stagedEmails)
        .where(
          inArray(
            s.stagedEmails.id,
            selected.slice(offset, offset + 100).map((r) => r.id),
          ),
        );
      await tx
        .insert(s.emails)
        .values(
          batch.map((r) => ({
            key: r.key,
            messageId: r.data.messageId,
            date: new Date(r.data.date),
            data: r.data,
            staffName: r.staffName,
            addressed: r.addressed,
            decision: r.decision,
            kind: "REVIEW" as const,
            searchText: [
              r.data.from.name,
              r.data.from.address,
              ...r.data.to.map((a) => a.address),
              ...r.data.cc.map((a) => a.address),
              r.data.subject,
              r.data.bodyText,
              r.staffName,
            ].join(" "),
          })),
        )
        .onConflictDoNothing();
      await tx
        .insert(s.emailImports)
        .values(batch.map((r) => ({ importId: id, emailKey: r.key })))
        .onConflictDoNothing();
    }
    const matches = await rebuild(tx);
    if (selected.some((r) => matches.get(r.key)?.kind === "REVIEW"))
      throw new DomainError(
        "Una relación cambió durante la incorporación; revisa los correos indicados.",
        selected
          .filter((r) => matches.get(r.key)?.kind === "REVIEW")
          .map((r) => ({
            id: r.id,
            subject: mailByKey.get(r.key)?.subject ?? r.key,
            reason: matches.get(r.key)!.reason,
          })),
      );
    await tx.update(s.stagedEmails).set({ state: "APPROVED" }).where(where);
    await tx
      .update(s.imports)
      .set({ approvedAt: new Date(), approvedBy: user })
      .where(eq(s.imports.id, id));
    await refreshStatus(tx, id);
    return selected.length;
  });
}
export async function reject(db: Database, id: string, ids: string[]) {
  await db.transaction(async (tx) => {
    await lock(tx);
    const imp = await getImport(tx, id);
    if (closed.includes(imp.status))
      throw new DomainError("Importación cerrada");
    await tx
      .update(s.stagedEmails)
      .set({ state: "REJECTED" })
      .where(
        and(
          eq(s.stagedEmails.importId, id),
          eq(s.stagedEmails.state, "PENDING"),
          inArray(s.stagedEmails.id, ids),
        ),
      );
    await refreshStatus(tx, id);
  });
}
export async function decide(
  db: Database,
  id: string,
  rowId: string,
  decision: Decision,
) {
  await db.transaction(async (tx) => {
    await lock(tx);
    const imp = await getImport(tx, id);
    if (closed.includes(imp.status) || imp.status === "PROCESSING")
      throw new DomainError("Finaliza el procesamiento antes de resolver");
    await refreshPendingStaff(tx);
    const [row] = await tx
      .select({ key: s.stagedEmails.key })
      .from(s.stagedEmails)
      .where(
        and(
          eq(s.stagedEmails.id, rowId),
          eq(s.stagedEmails.importId, id),
          eq(s.stagedEmails.state, "PENDING"),
        ),
      );
    if (!row) throw new DomainError("El registro ya no está pendiente");
    const mails = await metadata(tx, id);
    const mail = mails.find((m) => m.key === row.key)!;
    if (
      (
        await tx
          .select({ key: s.emails.key })
          .from(s.emails)
          .where(eq(s.emails.key, row.key))
      ).length
    )
      throw new DomainError(
        "Este correo ya existe en el histórico; aprueba su procedencia sin cambiar la decisión histórica",
      );
    const before = matchEmails(mails);
    // A manual unanswered decision excludes only currently associated responses, never future messages.
    decision = {
      ...decision,
      excludedResponseKeys:
        decision.kind === "REQUEST" && decision.requestStatus === "UNANSWERED"
          ? [
              ...new Set([
                ...(mail.decision?.excludedResponseKeys ?? []),
                ...[...before]
                  .filter(
                    ([, m]) => m.kind === "RESPONSE" && m.rootKey === row.key,
                  )
                  .map(([key]) => key),
              ]),
            ]
          : undefined,
    };
    mail.decision = decision;
    const verified = matchEmails(mails).get(row.key)!;
    if (verified.kind === "REVIEW") throw new DomainError(verified.reason);
    const result = await tx
      .update(s.stagedEmails)
      .set({ decision })
      .where(
        and(
          eq(s.stagedEmails.importId, id),
          eq(s.stagedEmails.id, rowId),
          eq(s.stagedEmails.state, "PENDING"),
        ),
      )
      .returning({ id: s.stagedEmails.id });
    if (!result.length)
      throw new DomainError("El registro ya no está pendiente");
  });
}
export async function discard(db: Database, id: string) {
  await db.transaction(async (tx) => {
    await lock(tx);
    await getImport(tx, id);
    await tx
      .delete(s.stagedEmails)
      .where(
        and(
          eq(s.stagedEmails.importId, id),
          eq(s.stagedEmails.state, "PENDING"),
        ),
      );
    await tx
      .update(s.imports)
      .set({ status: "DISCARDED", updatedAt: new Date() })
      .where(eq(s.imports.id, id));
  });
}
export async function revert(db: Database, id: string) {
  await db.transaction(async (tx) => {
    await lock(tx);
    await getImport(tx, id);
    await tx.delete(s.emailImports).where(eq(s.emailImports.importId, id));
    await tx.execute(
      sql`delete from emails e where not exists (select 1 from email_imports p where p."emailKey"=e.key)`,
    );
    await rebuild(tx);
    await tx
      .update(s.imports)
      .set({ status: "REVERTED", updatedAt: new Date() })
      .where(eq(s.imports.id, id));
  });
}
