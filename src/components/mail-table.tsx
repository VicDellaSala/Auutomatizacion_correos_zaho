import Link from "next/link";
import { Inbox } from "lucide-react";
import { dateTime, duration } from "@/lib/format";
import type { MailRow } from "@/lib/metrics/query";
import { attentionLabel } from "@/lib/metrics/attention";
export function MailTable({ rows }: { rows: MailRow[] }) {
  const sent =
    rows.length > 0 && rows.every((row) => row.kind === "STAFF_SENT");
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Recibida</th>
            <th>Remitente / asunto</th>
            {sent && <th>Para / CC / adjuntos</th>}
            <th>Estado</th>
            <th>Responsable</th>
            <th>Tiempo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ whiteSpace: "nowrap" }}>
                {dateTime(r.date)}
                <div className="preview" title={r.source ?? ""}>
                  {r.source}
                </div>
              </td>
              <td>
                <Link className="subject" href={`/conversations/${r.key}`}>
                  {r.data.subject}
                </Link>
                <Link
                  className="button secondary small"
                  href={`/emails/${r.key}/edit`}
                >
                  Editar
                </Link>
                <div className="muted">
                  {r.data.from.name || r.data.from.address}
                </div>
                {r.data.from.name && (
                  <div className="preview">{r.data.from.address}</div>
                )}
                <div className="preview">{r.data.preview}</div>
                <Link className="section-link" href={`/conversations/${r.key}`}>
                  Abrir correo completo →
                </Link>
              </td>
              {sent && (
                <td>
                  <div>
                    Para: {r.data.to.map((a) => a.address).join(", ") || "—"}
                  </div>
                  <div className="muted">
                    CC: {r.data.cc.map((a) => a.address).join(", ") || "—"}
                  </div>
                  <div className="preview">
                    Adjuntos:{" "}
                    {r.data.attachments.map((a) => a.filename).join(", ") ||
                      "Ninguno"}
                  </div>
                </td>
              )}
              <td>
                <span
                  className={`badge ${r.kind === "REVIEW" ? "red" : r.firstResponseKey ? "green" : r.kind === "STAFF_SENT" ? "" : "amber"}`}
                >
                  {attentionLabel[r.attention]}
                </span>
                {r.decision?.requestStatus === "ANSWERED" &&
                  !r.firstResponseKey && (
                    <div className="preview">Estado ajustado manualmente</div>
                  )}
                {r.attention === "IGNORED" && (
                  <div className="preview">{r.decision?.ignoredReason}</div>
                )}
                {r.kind === "RESPONSE" && !r.rootKey && (
                  <div className="preview">Sin asociación</div>
                )}
              </td>
              <td>
                {r.responder || r.staffName || "—"}
                {r.firstResponseAt && (
                  <div className="preview">{dateTime(r.firstResponseAt)}</div>
                )}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {duration(
                  r.attention === "IGNORED" ||
                    (r.decision?.requestStatus === "ANSWERED" &&
                      !r.firstResponseKey)
                    ? null
                    : (r.responseSeconds ??
                        (r.kind === "REQUEST" ? r.elapsedSeconds : null)),
                )}
                {!r.firstResponseKey &&
                  r.kind === "REQUEST" &&
                  ["UNANSWERED", "AFTER_HOURS"].includes(r.attention) && (
                    <div className="preview">transcurrido</div>
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty">
      <Inbox size={30} />
      <strong>No hay correos para mostrar</strong>Importa un ZIP y revisa los
      registros antes de incorporarlos al histórico.
    </div>
  );
}
