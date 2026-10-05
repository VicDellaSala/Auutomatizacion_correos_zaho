import Link from "next/link";
import { Inbox } from "lucide-react";
import { dateTime, duration } from "@/lib/format";
import type { MailRow } from "@/lib/metrics/query";
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
                <div className="muted">
                  {r.data.from.name || r.data.from.address}
                </div>
                {r.data.from.name && (
                  <div className="preview">{r.data.from.address}</div>
                )}
                <div className="preview">{r.data.preview}</div>
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
                  {r.kind === "REVIEW"
                    ? "Requiere revisión"
                    : r.kind === "STAFF_SENT"
                      ? "Correo iniciado"
                      : r.firstResponseKey
                        ? "Respondida"
                        : "No respondida"}
                </span>
              </td>
              <td>
                {r.responder || r.staffName || "—"}
                {r.firstResponseAt && (
                  <div className="preview">{dateTime(r.firstResponseAt)}</div>
                )}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {duration(
                  r.responseSeconds ??
                    (r.kind === "REQUEST" ? r.elapsedSeconds : null),
                )}
                {!r.firstResponseKey && r.kind === "REQUEST" && (
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
