export function dateTime(value: Date | string | null) {
  return value
    ? new Intl.DateTimeFormat("es-VE", {
        timeZone: "America/Caracas",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(value))
    : "—";
}
export function duration(seconds: number | null) {
  if (seconds === null) return "—";
  const mins = Math.max(0, Math.floor(seconds / 60));
  return mins < 60
    ? `${mins} min`
    : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}
export function bytes(value: number) {
  return value >= 1048576
    ? `${(value / 1048576).toFixed(1)} MB`
    : `${Math.round(value / 1024)} KB`;
}
export const kindLabel: Record<string, string> = {
  REQUEST: "Solicitud nueva",
  RESPONSE: "Respuesta",
  STAFF_SENT: "Correo iniciado",
  FOLLOWUP: "Seguimiento",
  REVIEW: "Requiere revisión",
  IGNORED: "Ignorados",
  AFTER_HOURS: "Pendientes fuera del horario",
};
export const statusLabel: Record<string, string> = {
  PROCESSING: "Procesando / interrumpida",
  PARTIAL: "Procesamiento parcial",
  READY_FOR_REVIEW: "Pendiente de revisión",
  PARTIALLY_APPROVED: "Aprobación parcial",
  APPROVED: "Revisión completada",
  DISCARDED: "Descartada",
  ERROR: "Error",
  REVERTED: "Revertida",
};
