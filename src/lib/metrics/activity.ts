import { sql } from "drizzle-orm";

// Identity follows a configured ID first, then the real sender's address.
// Names only recover legacy records when the configured match is unique.
export const activityCte = sql`with identities as (
  select e.key, coalesce(a.id::text, case when e.decision->>'responsibleId' is not null then 'legacy:' || (e.decision->>'responsibleId') end,
    case when coalesce(e.decision->>'responsibleName',e."staffName") is not null then 'legacy:' || lower(coalesce(e.decision->>'responsibleName',e."staffName")) end, 'unassigned') as "personId",
    coalesce(a.name,e.decision->>'responsibleName',e."staffName",'Sin asignar') as name
  from emails e left join lateral (
    select p.id,p.name from agents p where p.id::text=e.decision->>'responsibleId'
      or (e.decision->>'responsibleId' is null and e.kind in ('RESPONSE','STAFF_SENT') and lower(p.email)=lower(e.data->'from'->>'address'))
      or (e.decision->>'responsibleId' is null and lower(p.name)=lower(coalesce(e.decision->>'responsibleName',e."staffName"))
        and (select count(*) from agents u where lower(u.name)=lower(p.name))=1)
    order by (p.id::text=e.decision->>'responsibleId') desc nulls last,
      (lower(p.email)=lower(e.data->'from'->>'address')) desc,p.id limit 1
  ) a on true
), real_responses as (
  select r.key,r.date,r."rootKey",i."personId",i.name,
    case when root.key is not null then root.date end as "requestDate"
  from emails r join identities i on i.key=r.key left join emails root on root.key=r."rootKey"
  where r.kind='RESPONSE' and not coalesce((r.decision->>'ignored')::boolean,false)
    and (root.key is null or (root.kind='REQUEST' and not coalesce((root.decision->>'ignored')::boolean,false)))
), recipient_followups as (
  select f.key,f.date,f."rootKey",p.id::text as "personId",p.name,
    p.via
  from emails f join emails root on root.key=f."rootKey"
  join lateral (
    select a.id,a.name,
      case when dest.n <= jsonb_array_length(coalesce(f.data->'to','[]'::jsonb)) then 'Para' else 'CC' end as via
    from jsonb_array_elements(coalesce(f.data->'to','[]'::jsonb) || coalesce(f.data->'cc','[]'::jsonb)) with ordinality as dest(address,n)
    join agents a on a.active and lower(a.email)=lower(dest.address->>'address')
    order by dest.n,a.id limit 1
  ) p on true
  where f.kind='FOLLOWUP' and root.kind in ('REQUEST','STAFF_SENT') and f.date>root.date
    and not coalesce((f.decision->>'ignored')::boolean,false)
    and not coalesce((root.decision->>'ignored')::boolean,false)
    and not (coalesce(root.decision->'excludedResponseKeys','[]'::jsonb) ? f.key)
), credited_responses as (
  select key,date,"rootKey","personId",name,"requestDate",false as recipient,null::text as via from real_responses
  union all
  select key,date,"rootKey","personId",name,null::timestamptz,true,via from recipient_followups
), manual_candidates as (
  select e.key,e.key as "rootKey",i."personId",i.name,
    coalesce((e.decision->>'manualAnsweredAt')::timestamptz,
      (select (entry->>'at')::timestamptz from jsonb_array_elements(coalesce(e.decision->'audit','[]'::jsonb)) with ordinality as audit(entry,n)
       where entry->'after'->'decision'->>'requestStatus'='ANSWERED'
         and (entry->'before'->'decision'->>'requestStatus' is distinct from 'ANSWERED' or entry->'before'->>'kind' is distinct from 'REQUEST')
       order by n desc limit 1),
      (select min(coalesce(imp."approvedAt",imp."createdAt")) from email_imports p join imports imp on imp.id=p."importId" where p."emailKey"=e.key),e.date) as date,
    coalesce((e.decision->>'manualResponseAdditional')::boolean,false) as additional,
    e.decision->>'manualAnsweredAt' is null and not exists(
      select 1 from jsonb_array_elements(coalesce(e.decision->'audit','[]'::jsonb)) entry
      where entry->'after'->'decision'->>'requestStatus'='ANSWERED'
        and (entry->'before'->'decision'->>'requestStatus' is distinct from 'ANSWERED' or entry->'before'->>'kind' is distinct from 'REQUEST')
    ) as estimated
  from emails e join identities i on i.key=e.key
  where e.kind='REQUEST' and e.decision->>'requestStatus'='ANSWERED' and not coalesce((e.decision->>'ignored')::boolean,false)
), activity as (
  select key,date,"rootKey","personId",name,'RESPONSE'::text as type,false as manual,"requestDate",false as estimated,recipient,via from credited_responses
  union all
  select m.key,m.date,m."rootKey",m."personId",m.name,'RESPONSE',true,null::timestamptz,m.estimated,false,null::text from manual_candidates m
  where m.additional or not exists(select 1 from credited_responses r where r."rootKey"=m.key and (r."personId"=m."personId" or m."personId"='unassigned'))
  union all
  select e.key,e.date,null::text,i."personId",i.name,'STAFF_SENT',false,null::timestamptz,false,false,null::text
  from emails e join identities i on i.key=e.key where e.kind='STAFF_SENT' and not coalesce((e.decision->>'ignored')::boolean,false)
)`;

export function ignoredPercentage(ignored: number, received: number) {
  return received > 0 ? (ignored / received) * 100 : 0;
}
