import type { EmailData } from "@/types/email";
import { bytes, dateTime } from "@/lib/format";
export function EmailDetail({ data }: { data: EmailData }) {
  return (
    <>
      <div className="email-meta">
        <div>
          <b>De:</b> {data.from.name} &lt;{data.from.address}&gt;
        </div>
        <div>
          <b>Para:</b> {data.to.map((a) => a.address).join(", ") || "—"}
        </div>
        <div>
          <b>CC:</b> {data.cc.map((a) => a.address).join(", ") || "—"}
        </div>
        <div>
          <b>Fecha:</b> {dateTime(data.date)}
        </div>
      </div>
      <pre className="email-content">
        {data.newContent || data.bodyText || "(Correo sin cuerpo de texto)"}
      </pre>
      {data.newContent !== data.bodyText && (
        <details style={{ marginTop: 12 }}>
          <summary>Ver contenido completo e historial citado</summary>
          <pre className="email-content">{data.bodyText}</pre>
        </details>
      )}
      {data.attachments.length > 0 && (
        <p className="email-meta" style={{ marginTop: 12 }}>
          <b>Adjuntos (solo información):</b>
          <br />
          {data.attachments.map((a, i) => (
            <span key={i} style={{ display: "block" }}>
              {a.filename} · {a.mimeType} · {bytes(a.size)}
            </span>
          ))}
        </p>
      )}
      <details style={{ marginTop: 12, fontSize: 11 }}>
        <summary className="muted">Información técnica</summary>
        <div className="email-meta">
          Message-ID: {data.messageId || "No disponible"}
          <br />
          In-Reply-To: {data.inReplyTo.join(", ") || "—"}
          <br />
          References: {data.references.join(", ") || "—"}
          <br />
          Reply-To: {data.replyTo.map((a) => a.address).join(", ") || "—"}
          <br />
          Estado Zoho: {data.zohoStatus || "—"}
          <p>El estado Zoho no indica si el equipo atendió el mensaje.</p>
        </div>
      </details>
    </>
  );
}
