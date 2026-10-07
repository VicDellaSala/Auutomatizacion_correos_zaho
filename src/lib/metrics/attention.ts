import { sql } from "drizzle-orm";
import type { AttentionState, Decision, Kind } from "@/types/email";
export const attentionLabel: Record<AttentionState, string> = {
  ANSWERED: "Respondida",
  UNANSWERED: "No respondida",
  AFTER_HOURS: "Pendiente (fuera del horario)",
  IGNORED: "Ignorado",
  REVIEW: "Pendiente de revisión",
  STAFF_SENT: "Correo iniciado por personal",
  RESPONSE: "Respuesta del personal",
  FOLLOWUP: "Seguimiento",
};
export function attentionState(
  mail: { kind: Kind; date: Date | string; decision?: Decision | null },
  firstResponse: unknown,
): AttentionState {
  if (mail.decision?.ignored) return "IGNORED";
  if (mail.kind !== "REQUEST") return mail.kind;
  if (firstResponse || mail.decision?.requestStatus === "ANSWERED")
    return "ANSWERED";
  if (mail.decision?.requestStatus === "UNANSWERED") return "UNANSWERED";
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Caracas",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(mail.date));
  return mail.decision?.requestStatus === "AFTER_HOURS" || hour >= "16:50"
    ? "AFTER_HOURS"
    : "UNANSWERED";
}
// Aliases e (email) and c (conversation) are fixed by the official queries.
export const attentionSql = sql`case
  when coalesce((e.decision->>'ignored')::boolean,false) then 'IGNORED'
  when e.kind <> 'REQUEST' then e.kind
  when c."firstResponseKey" is not null or e.decision->>'requestStatus'='ANSWERED' then 'ANSWERED'
  when e.decision->>'requestStatus'='UNANSWERED' then 'UNANSWERED'
  when e.decision->>'requestStatus'='AFTER_HOURS' or (e.date at time zone 'America/Caracas')::time >= time '16:50' then 'AFTER_HOURS'
  else 'UNANSWERED' end`;
export const activeSql = sql`not coalesce((e.decision->>'ignored')::boolean,false)`;
