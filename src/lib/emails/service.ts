import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { emails, agents } from "@/lib/db/schema";
import {
  DomainError,
  lock,
  metadata,
  prepareDecision,
  rebuild,
} from "@/lib/imports/service";
import type { Decision, CorrectionSnapshot } from "@/types/email";
type Row = typeof emails.$inferSelect;
export function correctionVersion(row: Row) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.key,
        row.kind,
        row.rootKey,
        row.staffName,
        row.decision,
      ]),
    )
    .digest("hex");
}
function snapshot(row: Row): CorrectionSnapshot {
  const decision = row.decision ? { ...row.decision } : null;
  if (decision) delete decision.audit;
  return {
    kind: row.kind,
    rootKey: row.rootKey,
    staffName: row.staffName,
    decision,
  };
}
export async function editApproved(
  db: Database,
  key: string,
  input: Decision,
  version: string,
  user: { id: string; name: string },
) {
  return db.transaction(async (tx) => {
    await lock(tx);
    const [row] = await tx.select().from(emails).where(eq(emails.key, key));
    if (!row) throw new DomainError("Correo aprobado no encontrado");
    if (version !== correctionVersion(row))
      throw new DomainError(
        "El correo cambió desde que abriste la edición. Recarga antes de guardar",
      );
    const mails = await metadata(tx),
      mail = mails.find((m) => m.key === key)!;
    if (input.kind === "RESPONSE" && input.targetKey) {
      const [original] = await tx
        .select()
        .from(emails)
        .where(eq(emails.key, input.targetKey));
      if (original?.decision?.excludedResponseKeys?.includes(key)) {
        const decision = {
          ...original.decision,
          excludedResponseKeys: original.decision.excludedResponseKeys.filter(
            (k) => k !== key,
          ),
        };
        const afterRoot = { ...original, decision };
        decision.audit = [
          ...(original.decision.audit ?? []),
          {
            at: new Date().toISOString(),
            userId: user.id,
            userName: user.name,
            before: snapshot(original),
            after: snapshot(afterRoot),
          },
        ];
        await tx
          .update(emails)
          .set({ decision })
          .where(eq(emails.key, original.key));
        mails.find((m) => m.key === original.key)!.decision = decision;
      }
    }
    const [person] = await tx
      .select()
      .from(agents)
      .where(eq(agents.email, row.data.from.address));
    // Current configuration is consulted only for the record explicitly edited.
    mail.staffName = person?.active ? person.name : row.staffName;
    const decision = await prepareDecision(tx, mails, key, input);
    await tx
      .update(emails)
      .set({
        decision,
        staffName: mail.staffName,
        rootKey: null,
        kind: decision.kind,
      })
      .where(eq(emails.key, key));
    await rebuild(tx, [key]);
    const [after] = await tx.select().from(emails).where(eq(emails.key, key));
    const audit = [
      ...(row.decision?.audit ?? []),
      {
        at: new Date().toISOString(),
        userId: user.id,
        userName: user.name,
        before: snapshot(row),
        after: snapshot(after),
      },
    ];
    await tx
      .update(emails)
      .set({ decision: { ...decision, audit } })
      .where(eq(emails.key, key));
    return { ok: true };
  });
}
