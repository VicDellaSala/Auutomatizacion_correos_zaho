import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { agents } from "@/lib/db/schema";

export async function ensureJulia(db: Database) {
  await db
    .insert(agents)
    .values({ name: "Julia Lanz G", email: "julia.lanz@credicard.com.ve" })
    .onConflictDoNothing();
}
// Only pending snapshots change; official classifications retain approval-time staff.
export async function refreshPendingStaff(db: Database) {
  await ensureJulia(db);
  await db.execute(sql`with revised as (
    select s.id, (select a.name from agents a where a.active and a.email=lower(s.data->'from'->>'address') limit 1) as name,
    exists(select 1 from settings c, jsonb_array_elements((s.data->'to') || (s.data->'cc')) a where a->>'address'=c.mailbox) as addressed
    from staged_emails s where s.state='PENDING')
    update staged_emails s set "staffName"=r.name, addressed=r.addressed from revised r
    where s.id=r.id and (s."staffName" is distinct from r.name or s.addressed is distinct from r.addressed)`);
}
