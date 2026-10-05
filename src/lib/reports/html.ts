import type { Database } from "@/lib/db";
import { mailList, metrics, type Filters } from "@/lib/metrics/query";
import { dateTime, duration } from "@/lib/format";
import { emails } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
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
  yield `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte de atención</title><style>body{font:15px system-ui;color:#172e44;background:#f4f6f8;margin:0;padding:24px}main{max-width:1100px;margin:auto}h1{font-size:28px}h2{margin-top:32px}.cards{display:flex;gap:16px;flex-wrap:wrap}.card,details{background:white;border:1px solid #dce3eb;border-radius:8px;padding:18px;margin:10px 0}.card b{display:block;font-size:26px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}small{color:#526779}article{border-left:3px solid #bed0df;padding-left:16px;margin:18px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}@media(max-width:600px){body{padding:12px}.card{flex:1;min-width:120px}}</style><main><small>CONTROL DE ATENCIÓN · America/Caracas</small><h1>Reporte de atención de correos</h1><p>Período de recepción: ${esc(f.from || "Inicio del histórico")} — ${esc(f.to || "Último registro")}. Generado: ${esc(dateTime(new Date()))}</p><p>Solo correos aprobados. Los tiempos corresponden a la primera respuesta válida; se incluyen respuestas posteriores al período de recepción.</p><div class="cards">${[
    ["Solicitudes", m.received],
    ["Respondidas", m.answered],
    ["No respondidas", m.unanswered],
    ["Tasa de respuesta", m.rate.toFixed(1) + "%"],
    ["Tiempo promedio", duration(m.average)],
  ]
    .map(
      ([label, value]) =>
        `<div class="card">${label}<b>${esc(value)}</b></div>`,
    )
    .join(
      "",
    )}</div><h2>Respuestas por persona</h2><table><tr><th>Persona</th><th>Respuestas</th><th>Solicitudes atendidas</th></tr>${m.team.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.responses}</td><td>${r.requests}</td></tr>`).join("")}</table>`;
  for (const [view, title] of [
    ["answered", "Solicitudes respondidas"],
    ["staff-sent", "Correos enviados por personal"],
    ["unanswered", "Correos no respondidos"],
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
          .where(eq(emails.rootKey, row.key))
          .orderBy(asc(emails.date));
        yield `<details><summary>${esc(row.data.subject)} · ${esc(row.data.from.name || row.data.from.address)}</summary><p>${esc(row.data.preview)}</p><p>Recibida: ${esc(dateTime(row.date))} · Primera respuesta: ${esc(duration(row.responseSeconds))} · Responsable: ${esc(row.responder || row.staffName || "—")}</p>${thread.map((e) => `<article><b>${esc(e.staffName || e.data.from.name || e.data.from.address)}</b><p>${esc(dateTime(e.date))} · ${esc(e.kind)}</p><p>De: ${esc(e.data.from.address)} · Para: ${esc(e.data.to.map((a) => a.address).join(", "))} · CC: ${esc(e.data.cc.map((a) => a.address).join(", "))}</p><pre>${esc(e.data.bodyText)}</pre><small>Adjuntos: ${esc(e.data.attachments.map((a) => a.filename).join(", ") || "Ninguno")}</small></article>`).join("")}</details>`;
      }
      if (page * 40 >= count) break;
      page++;
    }
  }
  yield "</main></html>";
}
