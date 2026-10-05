import { createHash } from "node:crypto";
import { and, gte, lt, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { DomainError, lock, rebuild } from "./service";

export async function cleanupPreview(db: Database, from: string, to: string) {
  const start = new Date(from),
    end = new Date(to);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end <= +start)
    throw new DomainError("Indica un intervalo de importación válido");
  const imports = await db
    .select()
    .from(s.imports)
    .where(and(gte(s.imports.createdAt, start), lt(s.imports.createdAt, end)))
    .orderBy(s.imports.id);
  const ids = imports.map((i) => i.id);
  const provenance = ids.length
    ? await db
        .select()
        .from(s.emailImports)
        .where(inArray(s.emailImports.importId, ids))
    : [];
  const keys = [...new Set(provenance.map((p) => p.emailKey))];
  const shared = keys.length
    ? await db
        .select()
        .from(s.emailImports)
        .where(
          and(
            inArray(s.emailImports.emailKey, keys),
            sql`${s.emailImports.importId} not in ${ids}`,
          ),
        )
    : [];
  const survivors = new Set(shared.map((p) => p.emailKey));
  const removedKeys = keys.filter((key) => !survivors.has(key));
  const official = removedKeys.length
    ? await db
        .select({ key: s.emails.key, kind: s.emails.kind })
        .from(s.emails)
        .where(inArray(s.emails.key, removedKeys))
    : [];
  const staged = ids.length
    ? await db
        .select({
          key: s.stagedEmails.key,
          id: s.stagedEmails.id,
          state: s.stagedEmails.state,
          decision: s.stagedEmails.decision,
        })
        .from(s.stagedEmails)
        .where(inArray(s.stagedEmails.importId, ids))
        .orderBy(s.stagedEmails.id)
    : [];
  const totals = {
    imports: ids.length,
    emails: removedKeys.length,
    affectedEmails: new Set([...keys, ...staged.map((r) => r.key)]).size,
    staged: staged.length,
    requests: official.filter((e) => e.kind === "REQUEST").length,
    responses: official.filter((e) => e.kind === "RESPONSE").length,
    shared: survivors.size,
  };
  const token = createHash("sha256")
    .update(
      JSON.stringify({
        from,
        to,
        imports,
        staged,
        official: official.sort((a, b) => a.key.localeCompare(b.key)),
        shared: shared.sort((a, b) =>
          (a.importId + a.emailKey).localeCompare(b.importId + b.emailKey),
        ),
      }),
    )
    .digest("hex");
  return {
    from,
    to,
    token,
    totals,
    imports: imports.map((i) => ({
      id: i.id,
      filename: i.filename,
      createdAt: i.createdAt,
    })),
    removedKeys,
  };
}
export async function cleanupCommit(
  db: Database,
  from: string,
  to: string,
  token: string,
  confirm: string,
) {
  if (confirm !== "ELIMINAR")
    throw new DomainError(
      "Escribe ELIMINAR para confirmar la previsualización",
    );
  return db.transaction(async (tx) => {
    await lock(tx);
    const plan = await cleanupPreview(tx, from, to);
    if (plan.token !== token)
      throw new DomainError(
        "Los datos cambiaron desde la previsualización. Vuelve a previsualizar antes de borrar",
      );
    const ids = plan.imports.map((i) => i.id);
    if (ids.length)
      await tx.delete(s.imports).where(inArray(s.imports.id, ids));
    if (plan.removedKeys.length)
      await tx
        .delete(s.emails)
        .where(
          and(
            inArray(s.emails.key, plan.removedKeys),
            sql`not exists (select 1 from email_imports p where p."emailKey"=${s.emails.key})`,
          ),
        );
    await rebuild(tx);
    return plan.totals;
  });
}
