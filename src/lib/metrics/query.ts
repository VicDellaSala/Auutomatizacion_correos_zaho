import { sql, type SQL } from "drizzle-orm";
import { businessTimeSql } from "./business-time";
import { activeSql, attentionSql } from "./attention";
import { activityCte, ignoredPercentage } from "./activity";
import type { Database } from "@/lib/db";
import type { EmailData, Kind, Decision, AttentionState } from "@/types/email";
export type Filters = {
  from?: string;
  to?: string;
  q?: string;
  person?: string;
  personId?: string;
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
  activityDate?: Date;
  manualCredit?: boolean;
  recipientCredit?: boolean;
  recipientVia?: string | null;
  dateEstimated?: boolean;
};
export async function recipientCredits(db: Database, rootKey: string) {
  const result = await db.execute(sql`${activityCte}
    select key,name,via from recipient_followups where "rootKey"=${rootKey} order by date,key`);
  return result.rows as { key: string; name: string; via: string }[];
}
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
  return sql`${f.personId ? sql`and (e.key in (select key from identities where "personId"=${f.personId}) or exists(select 1 from credited_responses pr where (pr."rootKey"=e.key or pr.key=e.key) and pr."personId"=${f.personId}))` : sql``} ${term ? sql`and (e."searchText" ilike ${term} or exists (select 1 from emails sr where sr."rootKey"=e.key and sr."searchText" ilike ${term}))` : sql``}
    ${f.person ? sql`and (coalesce(e.decision->>'responsibleName',e."staffName")=${f.person} or exists(select 1 from emails pr where pr."rootKey"=e.key and pr.kind='RESPONSE' and not coalesce((pr.decision->>'ignored')::boolean,false) and coalesce(pr.decision->>'responsibleName',pr."staffName")=${f.person}))` : sql``}`;
}
export async function metrics(db: Database, f: Filters) {
  const result =
    await db.execute(sql`${activityCte} select count(*)::int as received,
    count(*) filter(where ${attentionSql}='ANSWERED')::int as answered,
    count(*) filter(where ${attentionSql}='UNANSWERED')::int as unanswered,
    count(*) filter(where ${attentionSql}='AFTER_HOURS')::int as "afterHours",
    count(*) filter(where c."firstResponseAt" is not null)::int as "timedRequests",
    coalesce(avg(case when c."firstResponseAt" is not null then ${businessTimeSql(sql`e.date`, sql`c."firstResponseAt"`)} end),0)::float as average
    from emails e left join conversations c on c."rootKey"=e.key where e.kind='REQUEST' and ${activeSql} ${rangeWhere(f)} ${searchWhere(f)}`);
  const activity = await db.execute(sql`${activityCte}
    select a."personId",a.name,
      count(*) filter(where a.type='RESPONSE')::int as responses,
      count(*) filter(where a.type='RESPONSE' and a.manual)::int as manual,
      count(*) filter(where a.type='RESPONSE' and a.recipient)::int as recipient,
      count(*) filter(where a.type='RESPONSE' and a.estimated)::int as estimated,
      count(distinct a."rootKey") filter(where a.type='RESPONSE' and exists(select 1 from emails original where original.key=a."rootKey" and original.kind='REQUEST'))::int as requests,
      count(*) filter(where a.type='RESPONSE' and a."rootKey" is null)::int as unassociated,
      avg(case when a.type='RESPONSE' and a."requestDate" is not null then ${businessTimeSql(sql`a."requestDate"`, sql`a.date`)} end)::float as average,
      count(*) filter(where a.type='STAFF_SENT')::int as initiated,count(*)::int as total
    from activity a join emails e on e.key=a.key where true
      ${rangeWhere(f, sql`a.date`)} ${searchWhere({ ...f, person: undefined, personId: undefined })}
      ${f.personId ? sql`and a."personId"=${f.personId}` : f.person ? sql`and a.name=${f.person}` : sql``}
    group by a."personId",a.name order by total desc,a.name,a."personId"`);
  const activities = activity.rows as unknown as {
    personId: string;
    name: string;
    responses: number;
    manual: number;
    recipient: number;
    estimated: number;
    requests: number;
    unassociated: number;
    average: number | null;
    initiated: number;
    total: number;
  }[];
  const team = activities
    .filter((p) => p.responses > 0)
    .sort((a, b) => b.responses - a.responses || a.name.localeCompare(b.name));
  const initiated = activities
    .filter((p) => p.initiated > 0)
    .map((p) => ({ personId: p.personId, name: p.name, count: p.initiated }));
  const pending = await db.execute(
    sql`select count(*)::int as count from staged_emails where state='PENDING'`,
  );
  const ignored = await db.execute(
    sql`${activityCte} select count(*)::int as count from emails e where not (${activeSql}) ${rangeWhere(f)} ${searchWhere(f)}`,
  );
  const row = result.rows[0] as {
    received: number;
    answered: number;
    unanswered: number;
    afterHours: number;
    average: number;
    timedRequests: number;
  };
  const evaluated = row.answered + row.unanswered;
  return {
    ...row,
    evaluated,
    ignored: Number(ignored.rows[0].count),
    rate: evaluated ? (100 * row.answered) / evaluated : 0,
    responses: team.reduce((n, r) => n + r.responses, 0),
    manualResponses: team.reduce((n, r) => n + r.manual, 0),
    recipientResponses: team.reduce((n, r) => n + r.recipient, 0),
    manualDateEstimated: team.reduce((n, r) => n + r.estimated, 0),
    initiatedTotal: initiated.reduce((n, r) => n + r.count, 0),
    sent: activities.reduce((n, r) => n + r.total, 0),
    ignoredPercent: ignoredPercentage(
      Number(ignored.rows[0].count),
      row.received,
    ),
    activities,
    team,
    initiated,
    pending: Number(pending.rows[0].count),
  };
}
export async function mailList(db: Database, f: Filters, pageSize = 40) {
  if (f.view === "responses") return responseList(db, f, pageSize);
  const kind =
    f.view === "ignored"
      ? sql`not (${activeSql})`
      : f.view === "staff-sent"
        ? sql`e.kind='STAFF_SENT' and ${activeSql}`
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
  const where = sql`${kind} ${state} ${rangeWhere(f)} ${searchWhere(f)}`;
  const result =
    await db.execute(sql`${activityCte} select e.key,e.data,e.date,e.kind,e.decision,e."rootKey",e."staffName",${attentionSql} as attention,c."firstResponseAt",c."firstResponseKey",
    case when c."firstResponseAt" is not null then ${businessTimeSql(sql`e.date`, sql`c."firstResponseAt"`)} end as "responseSeconds",
    coalesce(c."responseCount",0)+(select count(*)::int from recipient_followups where "rootKey"=e.key) as "responseCount",
    exists(select 1 from recipient_followups where "rootKey"=e.key) as "recipientCredit",
    coalesce(case when e.decision->>'responsibleId' is not null then (select name from identities where key=e.key) end,
      (select name from identities where key=r.key),
      (select name from recipient_followups where "rootKey"=e.key order by date,key limit 1),
      (select name from identities where key=e.key),'Sin asignar') as responder,
    ${businessTimeSql(sql`e.date`, sql`now()`)} as "elapsedSeconds",
    (select string_agg(i.filename,', ') from email_imports p join imports i on i.id=p."importId" where p."emailKey"=e.key) as source
    from emails e left join conversations c on c."rootKey"=e.key left join emails r on r.key=c."firstResponseKey" where ${where}
    order by e.date desc,e.key limit ${pageSize} offset ${(Math.max(1, f.page ?? 1) - 1) * pageSize}`);
  const count = await db.execute(
    sql`${activityCte} select count(*)::int as count from emails e left join conversations c on c."rootKey"=e.key where ${where}`,
  );
  return {
    rows: result.rows as unknown as MailRow[],
    count: Number(count.rows[0].count),
  };
}

async function responseList(db: Database, f: Filters, pageSize: number) {
  const where = sql`a.type='RESPONSE' ${rangeWhere(f, sql`a.date`)} ${searchWhere({ ...f, person: undefined, personId: undefined })}
    ${f.personId ? sql`and a."personId"=${f.personId}` : f.person ? sql`and a.name=${f.person}` : sql``}`;
  const rows =
    await db.execute(sql`${activityCte} select e.key,e.data,e.date,e.kind,e.decision,e."rootKey",e."staffName",
    case when a.manual then 'ANSWERED' else 'RESPONSE' end as attention,
    a.date as "activityDate",a.manual as "manualCredit",a.recipient as "recipientCredit",a.via as "recipientVia",a.estimated as "dateEstimated",null::timestamptz as "firstResponseAt",null::text as "firstResponseKey",
    case when a."requestDate" is not null then ${businessTimeSql(sql`a."requestDate"`, sql`a.date`)} end as "responseSeconds",
    1 as "responseCount",a.name as responder,0 as "elapsedSeconds",
    (select string_agg(i.filename,', ') from email_imports p join imports i on i.id=p."importId" where p."emailKey"=e.key) as source
    from activity a join emails e on e.key=a.key where ${where} order by a.date desc,e.key
    limit ${pageSize} offset ${(Math.max(1, f.page ?? 1) - 1) * pageSize}`);
  const count = await db.execute(
    sql`${activityCte} select count(*)::int as count from activity a join emails e on e.key=a.key where ${where}`,
  );
  return {
    rows: rows.rows as unknown as MailRow[],
    count: Number(count.rows[0].count),
  };
}
