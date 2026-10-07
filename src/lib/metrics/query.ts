import { sql, type SQL } from "drizzle-orm";
import { businessTimeSql } from "./business-time";
import { activeSql, attentionSql } from "./attention";
import type { Database } from "@/lib/db";
import type { EmailData, Kind, Decision, AttentionState } from "@/types/email";
export type Filters = {
  from?: string;
  to?: string;
  q?: string;
  person?: string;
  view?: string;
  page?: number;
};
export type MailRow = {
  key: string;
  data: EmailData;
  date: Date;
  kind: Kind;
  staffName: string | null;
  decision: Decision | null;
  attention: AttentionState;
  firstResponseAt: Date | null;
  firstResponseKey: string | null;
  responseSeconds: number | null;
  responseCount: number;
  responder: string | null;
  source: string | null;
  elapsedSeconds: number;
  rootKey: string | null;
};
export function rangeWhere(filters: Filters, date: SQL = sql`e.date`) {
  const from =
    filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)
      ? new Date(`${filters.from}T00:00:00-04:00`)
      : null;
  const to =
    filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)
      ? new Date(+new Date(`${filters.to}T00:00:00-04:00`) + 86400000)
      : null;
  return sql`${from ? sql`and ${date} >= ${from.toISOString()}::timestamptz` : sql``} ${to ? sql`and ${date} < ${to.toISOString()}::timestamptz` : sql``}`;
}
export function searchWhere(f: Filters) {
  const term = f.q ? `%${f.q.replace(/[\\%_]/g, "\\$&")}%` : null;
  return sql`${term ? sql`and (e."searchText" ilike ${term} or exists (select 1 from emails sr where sr."rootKey"=e.key and sr."searchText" ilike ${term}))` : sql``}
    ${f.person ? sql`and (coalesce(e.decision->>'responsibleName',e."staffName")=${f.person} or exists(select 1 from emails pr where pr."rootKey"=e.key and pr.kind='RESPONSE' and not coalesce((pr.decision->>'ignored')::boolean,false) and coalesce(pr.decision->>'responsibleName',pr."staffName")=${f.person}))` : sql``}`;
}
export async function metrics(db: Database, f: Filters) {
  const result = await db.execute(sql`select count(*)::int as received,
    count(*) filter(where ${attentionSql}='ANSWERED')::int as answered,
    count(*) filter(where ${attentionSql}='UNANSWERED')::int as unanswered,
    count(*) filter(where ${attentionSql}='AFTER_HOURS')::int as "afterHours",
    coalesce(avg(case when c."firstResponseAt" is not null then ${businessTimeSql(sql`e.date`, sql`c."firstResponseAt"`)} end),0)::float as average
    from emails e left join conversations c on c."rootKey"=e.key where e.kind='REQUEST' and ${activeSql} ${rangeWhere(f)} ${searchWhere(f)}`);
  const team =
    await db.execute(sql`select coalesce(r.decision->>'responsibleName',r."staffName") as name, count(*)::int as responses,
    count(distinct root.key)::int as requests, count(*) filter(where root.key is null)::int as unassociated,
    avg(case when root.key is not null then ${businessTimeSql(sql`root.date`, sql`r.date`)} end)::float as average
    from emails r left join emails root on root.key=r."rootKey" join emails e on e.key=coalesce(root.key,r.key)
    where r.kind='RESPONSE' and not coalesce((r.decision->>'ignored')::boolean,false) and ${activeSql} and (root.key is null or root.kind='REQUEST')
    ${rangeWhere(f)} ${searchWhere({ ...f, person: undefined })} ${f.person ? sql`and coalesce(r.decision->>'responsibleName',r."staffName")=${f.person}` : sql``}
    group by coalesce(r.decision->>'responsibleName',r."staffName") order by responses desc`);
  const initiated = await db.execute(
    sql`select coalesce(e.decision->>'responsibleName',e."staffName") as name,count(*)::int as count from emails e where e.kind='STAFF_SENT' and ${activeSql} ${rangeWhere(f)} ${searchWhere(f)} group by coalesce(e.decision->>'responsibleName',e."staffName")`,
  );
  const pending = await db.execute(
    sql`select count(*)::int as count from staged_emails where state='PENDING'`,
  );
  const ignored = await db.execute(
    sql`select count(*)::int as count from emails e where not (${activeSql}) ${rangeWhere(f)} ${searchWhere(f)}`,
  );
  const row = result.rows[0] as {
    received: number;
    answered: number;
    unanswered: number;
    afterHours: number;
    average: number;
  };
  const evaluated = row.answered + row.unanswered;
  return {
    ...row,
    evaluated,
    ignored: Number(ignored.rows[0].count),
    rate: evaluated ? (100 * row.answered) / evaluated : 0,
    responses: team.rows.reduce((n, r) => n + Number(r.responses), 0),
    team: team.rows as {
      name: string;
      responses: number;
      requests: number;
      unassociated: number;
      average: number | null;
    }[],
    initiated: initiated.rows as { name: string; count: number }[],
    pending: Number(pending.rows[0].count),
  };
}
export async function mailList(db: Database, f: Filters, pageSize = 40) {
  const kind =
    f.view === "ignored"
      ? sql`not (${activeSql})`
      : f.view === "staff-sent"
        ? sql`e.kind='STAFF_SENT' and ${activeSql}`
        : f.view === "responses"
          ? sql`e.kind='RESPONSE' and ${activeSql} and not exists(select 1 from emails ir where ir.key=e."rootKey" and coalesce((ir.decision->>'ignored')::boolean,false))`
          : f.view === "review"
            ? sql`e.kind='REVIEW' and ${activeSql}`
            : sql`e.kind='REQUEST' and ${activeSql}`;
  const filterState = (
    {
      answered: "ANSWERED",
      unanswered: "UNANSWERED",
      "after-hours": "AFTER_HOURS",
    } as Record<string, string>
  )[f.view ?? ""];
  const state = filterState ? sql`and ${attentionSql}=${filterState}` : sql``;
  const where = sql`${kind} ${state} ${rangeWhere(f, f.view === "responses" ? sql`coalesce((select root.date from emails root where root.key=e."rootKey"),e.date)` : sql`e.date`)} ${searchWhere(f)}`;
  const result =
    await db.execute(sql`select e.key,e.data,e.date,e.kind,e.decision,e."rootKey",e."staffName",${attentionSql} as attention,c."firstResponseAt",c."firstResponseKey",
    case when c."firstResponseAt" is not null then ${businessTimeSql(sql`e.date`, sql`c."firstResponseAt"`)} end as "responseSeconds",
    coalesce(c."responseCount",0) as "responseCount",coalesce(e.decision->>'responsibleName',r.decision->>'responsibleName',r."staffName") as responder,
    ${businessTimeSql(sql`e.date`, sql`now()`)} as "elapsedSeconds",
    (select string_agg(i.filename,', ') from email_imports p join imports i on i.id=p."importId" where p."emailKey"=e.key) as source
    from emails e left join conversations c on c."rootKey"=e.key left join emails r on r.key=c."firstResponseKey" where ${where}
    order by e.date desc,e.key limit ${pageSize} offset ${(Math.max(1, f.page ?? 1) - 1) * pageSize}`);
  const count = await db.execute(
    sql`select count(*)::int as count from emails e left join conversations c on c."rootKey"=e.key where ${where}`,
  );
  return {
    rows: result.rows as unknown as MailRow[],
    count: Number(count.rows[0].count),
  };
}
