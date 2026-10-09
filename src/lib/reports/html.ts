import type { Database } from "@/lib/db";
import { mailList, metrics, type Filters } from "@/lib/metrics/query";
import { dateTime, duration } from "@/lib/format";
import { emails } from "@/lib/db/schema";
import { attentionLabel } from "@/lib/metrics/attention";
import { eq, asc, or } from "drizzle-orm";
import { businessSeconds } from "@/lib/metrics/business-time";
export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export async function* reportHtml(db: Database, f: Filters) {
  const m = await metrics(db, f),
    esc = escapeHtml;
  yield `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte de atención</title><style>body{font:15px system-ui;color:#172e44;background:#f4f6f8;margin:0;padding:24px}main{max-width:1100px;margin:auto}h1{font-size:28px}h2{margin-top:32px}.cards{display:flex;gap:16px;flex-wrap:wrap}.card,details{background:white;border:1px solid #dce3eb;border-radius:8px;padding:18px;margin:10px 0}.card b{display:block;font-size:26px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}small{color:#526779}article{border-left:3px solid #bed0df;padding-left:16px;margin:18px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}@media(max-width:600px){body{padding:12px}.card{flex:1;min-width:120px}}</style><main><small>CONTROL DE ATENCIÓN · America/Caracas</small><h1>Reporte de atención de correos</h1><p>Período seleccionado: ${esc(f.from || "Inicio del histórico")} — ${esc(f.to || "Último registro")}. Generado: ${esc(dateTime(new Date()))}</p><p>Solo correos aprobados. Solicitudes por recepción; actividad por fecha de envío o acreditación manual. Correos enviados incluye gestiones manuales sin email. La tasa excluye pendientes fuera del horario e ignorados; las respuestas sin asociación no generan tiempos ni solicitudes respondidas. Los tiempos usan la ventana diaria 08:00–17:00 America/Caracas, incluidos fines de semana. El promedio general corresponde a la primera respuesta válida; se incluyen respuestas posteriores al período de recepción.</p><div class="cards">${[
    ["Solicitudes", m.received],
    ["Respondidas", m.answered],
    ["Respuestas realizadas", m.responses],
    ["Correos enviados", m.sent],
    ["No respondidas", m.unanswered],
    ["Pendientes fuera del horario", m.afterHours],
    [
      "Ignorados",
      `${m.ignored} · ${m.ignoredPercent.toFixed(1).replace(".", ",")} % de solicitudes recibidas`,
    ],
    ["Tasa de respuesta", m.rate.toFixed(1) + "%"],
    ["Tiempo promedio", duration(m.timedRequests ? m.average : null)],
  ]
    .map(
      ([label, value]) =>
        `<div class="card">${label}<b>${esc(value)}</b></div>`,
    )
    .join(
      "",
    )}</div><h2>Respuestas por persona</h2><table><tr><th>Persona</th><th>Respuestas</th><th>Solicitudes atendidas</th><th>Tiempo promedio por respuesta</th></tr>${m.team.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.responses}</td><td>${r.requests}</td><td>${esc(duration(r.average))}</td></tr>`).join("")}</table>`;
  yield `<h2>Correos iniciados por personal</h2><table><tr><th>Persona</th><th>Correos iniciados</th></tr>${m.initiated.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.count}</td></tr>`).join("")}</table><h2>Gestiones realizadas totales</h2><table><tr><th>Persona</th><th>Respuestas realizadas</th><th>Correos iniciados</th><th>Total gestiones</th></tr>${m.activities.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.responses}</td><td>${p.initiated}</td><td>${p.total}</td></tr>`).join("")}<tr><th>TOTAL GENERAL</th><th>${m.responses}</th><th>${m.initiatedTotal}</th><th>${m.sent}</th></tr></table>`;
  if (m.manualDateEstimated) {
    yield `<p>${m.manualDateEstimated} acreditaciones manuales antiguas usan la fecha de incorporación como referencia porque no tienen fecha de ajuste guardada.</p>`;
  }
  for (const [view, title] of [
    ["answered", "Solicitudes respondidas"],
    ["staff-sent", "Correos enviados por personal"],
    ["unanswered", "Correos no respondidos"],
    ["after-hours", "Pendientes (fuera del horario)"],
    ["responses", "Respuestas realizadas, incluidas sin asociación"],
    ["ignored", "Ignorados (fuera de métricas)"],
  ]) {
    yield `<h2>${title}</h2>`;
    let page = 1;
    while (true) {
      const { rows, count } = await mailList(db, { ...f, view, page }, 40);
      if (!count) yield "<p>Sin registros en este período.</p>";
      for (const row of rows) {
        const thread = await db
          .select()
          .from(emails)
          .where(or(eq(emails.rootKey, row.key), eq(emails.key, row.key)))
          .orderBy(asc(emails.date));
        yield `<details><summary>${esc(row.data.subject)} · ${esc(row.data.from.name || row.data.from.address)}</summary><p>${esc(row.data.preview)}</p><p>Estado: ${esc(attentionLabel[row.attention])}${row.manualCredit ? " · Respuesta acreditada manualmente" : ""}${row.decision?.requestStatus === "ANSWERED" && !row.firstResponseKey ? " · Estado ajustado manualmente" : ""} · ${esc(row.decision?.ignoredReason ?? "")}</p><p>Origen: ${esc(row.source)} · Respuestas realizadas: ${row.responseCount}</p><p>${row.activityDate ? "Fecha de gestión" : "Recibida"}: ${esc(dateTime(row.activityDate ?? row.date))} · Primera respuesta: ${esc(duration(row.responseSeconds))} · Responsable: ${esc(row.responder || row.staffName || "—")}</p>${thread.map((e) => `<article><b>${esc(e.staffName || e.data.from.name || e.data.from.address)}</b><p>${esc(dateTime(e.date))} · ${esc(e.decision?.ignored ? "Ignorado" : e.kind)}${e.kind === "RESPONSE" && e.rootKey && row.kind === "REQUEST" && !e.decision?.ignored && !row.decision?.ignored ? ` · Tiempo operativo: ${esc(duration(businessSeconds(row.date, e.date)))}` : ""}</p><p>De: ${esc(e.data.from.address)} · Para: ${esc(e.data.to.map((a) => a.address).join(", "))} · CC: ${esc(e.data.cc.map((a) => a.address).join(", "))}</p><pre>${esc(e.data.bodyText)}</pre><small>Adjuntos: ${esc(e.data.attachments.map((a) => a.filename).join(", ") || "Ninguno")}</small></article>`).join("")}</details>`;
      }
      if (page * 40 >= count) break;
      page++;
    }
  }
  yield "</main></html>";
}
