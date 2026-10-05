import { sql, type SQL } from "drizzle-orm";

// Daily window, including weekends. PostgreSQL applies the IANA timezone.
export function businessTimeSql(start: SQL, end: SQL) {
  return sql`(select coalesce(sum(greatest(0, extract(epoch from
    (least(${end}, (d::date + time '17:00') at time zone 'America/Caracas') -
     greatest(${start}, (d::date + time '08:00') at time zone 'America/Caracas'))))),0)::float
    from generate_series((${start} at time zone 'America/Caracas')::date,
      (${end} at time zone 'America/Caracas')::date, interval '1 day') d)`;
}

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Caracas",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function localParts(date: Date) {
  const p = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return [
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  ] as const;
}
function localHour(day: number, hour: number) {
  const desired = day + hour * 3600000;
  let utc = desired;
  for (let i = 0; i < 3; i++)
    utc += desired - Date.UTC(...localParts(new Date(utc)));
  return utc;
}
export function businessSeconds(
  start: string | Date,
  end: string | Date,
): number {
  const a = new Date(start),
    b = new Date(end);
  if (!Number.isFinite(+a) || !Number.isFinite(+b) || +b <= +a) return 0;
  const p = localParts(a),
    q = localParts(b);
  let result = 0;
  for (
    let day = Date.UTC(p[0], p[1], p[2]), last = Date.UTC(q[0], q[1], q[2]);
    day <= last;
    day += 86400000
  )
    result += Math.max(
      0,
      Math.min(+b, localHour(day, 17)) - Math.max(+a, localHour(day, 8)),
    );
  return result / 1000;
}
