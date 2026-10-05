import { sql } from "drizzle-orm";
import { businessTimeSql } from "./business-time";
import type { Database } from "@/lib/db";
import type { EmailData, Kind } from "@/types/email";
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
  firstResponseAt: Date | null;
  firstResponseKey: string | null;
  responseSeconds: number | null;
  responseCount: number;
  responder: string | null;
  source: string | null;
  elapsedSeconds: number;
};
export function rangeWhere(filters: Filters) {
  const from =
    filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)
      ? new Date(`${filters.from}T00:00:00-04:00`)
      : null;
  const to =
    filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)
      ? new Date(new Date(`${filters.to}T00:00:00-04:00`).getTime() + 86400000)
      : null;
  return sql`${from ? sql`and e.date >= ${from.toISOString()}::timestamptz` : sql``} ${to ? sql`and e.date < ${to.toISOString()}::timestamptz` : sql``}`;
}
export function searchWhere(f: Filters) {
  const term = f.q ? `%${f.q.replace(/[\\%_]/g, "\\$&")}%` : null;
  return sql`${term ? sql`and (e."searchText" ilike ${term} or exists (select 1 from emails sr where sr."rootKey"=e.key and sr."searchText" ilike ${term}))` : sql``}
    ${f.person ? sql`and (e."staffName"=${f.person} or exists(select 1 from emails pr where pr."rootKey"=e.key and pr.kind='RESPONSE' and pr."staffName"=${f.person}))` : sql``}`;
}
export async function metrics(db: Database, f: Filters) {
  const result =
    await db.execute(sql`select count(*)::int as received, count(c."firstResponseKey")::int as answered,
    (count(*)-count(c."firstResponseKey"))::int as unanswered, coalesce(avg(case when c."firstResponseAt" is not null then ${businessTimeSql(sql`e.date`, sql`c."firstResponseAt"`)} end),0)::float as average
    from emails e left join conversations c on c."rootKey"=e.key where e.kind='REQUEST' ${rangeWhere(f)} ${searchWhere(f)}`);
  const team =
    await db.execute(sql`select r."staffName" as name, count(*)::int as responses, count(distinct e.key)::int as requests, avg(${businessTimeSql(sql`e.date`, sql`r.date`)})::float as average
    from emails r join emails e on e.key=r."rootKey" where r.kind='RESPONSE' ${rangeWhere(f)} ${searchWhere(f)} group by r."staffName" order by responses desc`);
  const initiated = await db.execute(
    sql`select e."staffName" as name,count(*)::int as count from emails e where e.kind='STAFF_SENT' ${rangeWhere(f)} ${searchWhere(f)} group by e."staffName"`,
  );
  const pending = await db.execute(
    sql`select count(*)::int as count from staged_emails where state='PENDING'`,
  );
  const row = result.rows[0] as {
    received: number;
    answered: number;
    unanswered: number;
    average: number;
  };
  return {
    ...row,
    rate: row.received ? (100 * row.answered) / row.received : 0,
    responses: team.rows.reduce((n, r) => n + Number(r.responses), 0),
    team: team.rows as {
      name: string;
      responses: number;
      requests: number;
      average: number;
    }[],
    initiated: initiated.rows as { name: string; count: number }[],
    pending: Number(pending.rows[0].count),
  };
}
export async function mailList(db: Database, f: Filters, pageSize = 40) {
  const kind =
    f.view === "staff-sent"
      ? sql`e.kind='STAFF_SENT'`
      : f.view === "review"
        ? sql`e.kind='REVIEW'`
        : sql`e.kind='REQUEST'`;
  const state =
    f.view === "answered"
      ? sql`and c."firstResponseKey" is not null`
      : f.view === "unanswered"
        ? sql`and c."firstResponseKey" is null`
        : sql``;
  const where = sql`${kind} ${state} ${rangeWhere(f)} ${searchWhere(f)}`;
  const result =
    await db.execute(sql`select e.key,e.data,e.date,e.kind,e."staffName",c."firstResponseAt",c."firstResponseKey",case when c."firstResponseAt" is not null then ${businessTimeSql(sql`e.date`, sql`c."firstResponseAt"`)} end as "responseSeconds",coalesce(c."responseCount",0) as "responseCount",r."staffName" as responder,${businessTimeSql(sql`e.date`, sql`now()`)} as "elapsedSeconds",
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
