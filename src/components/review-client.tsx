"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmailDetail } from "./email-detail";
import { dateTime, duration, kindLabel } from "@/lib/format";
import type { Decision, EmailData, Match } from "@/types/email";
type ReviewRow = {
  id: string;
  key: string;
  data: EmailData;
  state: string;
  match: Match;
  decision: Decision | null;
  attention?: string;
  needsOriginal?: boolean;
  change?: {
    subject: string;
    date: string;
    seconds: number;
    wasAnswered: boolean;
    responder: string;
  };
};
export function ReviewClient({
  id,
  rows,
  editable,
  canRevert,
  focus,
}: {
  id: string;
  rows: ReviewRow[];
  editable: boolean;
  canRevert: boolean;
  focus?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState("");
  const [issues, setIssues] = useState<
    { id: string; subject: string; reason: string }[]
  >([]);
  async function action(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setIssues([]);
    try {
      const r = await fetch(`/api/imports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selected, ...extra }),
      });
      const v = await r.json();
      if (!r.ok) {
        setIssues(v.issues ?? []);
        throw new Error(v.error);
      }
      setSelected([]);
      setConfirm("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de conexión");
    } finally {
      setBusy(false);
    }
  }
  const pending = rows.filter((r) => r.state === "PENDING");
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {issues.length > 0 && (
        <div className="error">
          {issues.map((issue) => (
            <p key={issue.id}>
              <b>{issue.subject}</b>: {issue.reason}{" "}
              <a
                className="link"
                href={`?focus=${issue.id}#registro-${issue.id}`}
              >
                Resolver →
              </a>
            </p>
          ))}
        </div>
      )}
      {editable && (
        <div className="panel panel-body">
          <div className="actions">
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => setSelected(pending.map((r) => r.id))}
            >
              Seleccionar esta página
            </button>
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => setSelected([])}
            >
              Deseleccionar todo
            </button>
            <span className="muted">{selected.length} seleccionados</span>
            <button
              className="button"
              disabled={busy || !selected.length}
              onClick={() => action("approve")}
            >
              Aprobar e incorporar seleccionados
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm("all")}
            >
              Aprobar todos los pendientes
            </button>
            <button
              className="button danger"
              disabled={busy || !selected.length}
              onClick={() => action("reject")}
            >
              Rechazar seleccionados
            </button>
          </div>
        </div>
      )}
      {confirm && (
        <div className="notice warning">
          <p>
            {confirm === "all"
              ? "Se incorporarán todos los correos pendientes de esta importación, incluidos los de otras páginas. Los casos sin resolver impedirán la aprobación."
              : confirm === "discard"
                ? "Se eliminará el staging pendiente. Los correos ya aprobados permanecerán en el histórico."
                : "Se retirará la procedencia de esta importación y se recalculará el histórico. Los correos con otra importación válida se conservarán; algunas respuestas pueden quedar sin solicitud."}
          </p>
          <div className="actions">
            <button
              disabled={busy}
              className="button"
              onClick={() =>
                action(
                  confirm === "all"
                    ? "approve"
                    : confirm === "discard"
                      ? "discard"
                      : "revert",
                  confirm === "all" ? { all: true } : { confirm: "REVERTIR" },
                )
              }
            >
              Confirmar{" "}
              {confirm === "all"
                ? "aprobación"
                : confirm === "discard"
                  ? "descarte"
                  : "reversión"}
            </button>
            <button
              disabled={busy}
              className="button secondary"
              onClick={() => setConfirm("")}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      <section className="panel">
        {rows.length ? (
          rows.map((r) => (
            <div className="review-row" key={r.id} id={`registro-${r.id}`}>
              <input
                type="checkbox"
                aria-label={`Seleccionar ${r.data.subject}`}
                disabled={!editable || r.state !== "PENDING" || busy}
                title={
                  !editable
                    ? "No seleccionable: importación cerrada o en procesamiento"
                    : r.state !== "PENDING"
                      ? "No seleccionable: registro ya resuelto"
                      : busy
                        ? "Operación en curso"
                        : "Seleccionar para aprobar o rechazar"
                }
                checked={selected.includes(r.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, r.id]
                      : selected.filter((v) => v !== r.id),
                  )
                }
              />
              <details open={focus === r.id ? true : undefined}>
                <summary>
                  <div>
                    <span className="subject">{r.data.subject}</span>
                    <span
                      className="muted"
                      style={{ fontSize: 11, fontWeight: 400 }}
                    >
                      {r.data.from.name || r.data.from.address} ·{" "}
                      {dateTime(r.data.date)}
                    </span>
                  </div>
                  <span
                    className={`badge ${r.match.kind === "REVIEW" ? "amber" : r.match.kind === "RESPONSE" ? "green" : ""}`}
                  >
                    {r.state !== "PENDING"
                      ? r.state === "APPROVED"
                        ? "Aprobado"
                        : "Rechazado"
                      : kindLabel[r.match.kind]}
                  </span>
                </summary>
                <p className="muted" style={{ fontSize: 12 }}>
                  {r.match.reason}
                </p>
                {r.attention && (
                  <p>
                    Estado de la solicitud al aprobar: <b>{r.attention}</b>
                  </p>
                )}
                {r.needsOriginal && (
                  <p className="notice">
                    Al aprobar este correo se incorporarán también su original y
                    las dependencias pendientes de la conversación.
                  </p>
                )}
                {editable && r.match.kind !== "REVIEW" && r.match.rootKey && (
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      action("approve", { conversation: r.match.rootKey })
                    }
                  >
                    Aprobar conversación completa
                  </button>
                )}
                {r.change && (
                  <div className="notice warning">
                    <b>{r.change.subject}</b>
                    <p>
                      Solicitud recibida: {dateTime(r.change.date)}
                      <br />
                      Estado actual:{" "}
                      {r.change.wasAnswered ? "Respondida" : "No respondida"}
                      <br />
                      Si apruebas: Respondida · Respuesta de{" "}
                      {r.change.responder}
                      <br />
                      Fecha de esta respuesta: {dateTime(r.data.date)}
                      <br />
                      Tiempo operativo desde la solicitud (08:00–17:00):{" "}
                      {duration(r.change.seconds)}
                    </p>
                  </div>
                )}
                <EmailDetail data={r.data} />
                {editable && r.state === "PENDING" && (
                  <ManualDecision
                    importId={id}
                    mailKey={r.key}
                    initialKind={
                      r.match.kind === "REVIEW"
                        ? (r.decision?.kind ?? "REQUEST")
                        : r.match.kind
                    }
                    initialStatus={r.decision?.requestStatus}
                    unresolved={r.match.kind === "REVIEW"}
                    initialTarget={
                      r.match.rootKey && r.match.rootKey !== r.key
                        ? r.match.rootKey
                        : ""
                    }
                    onSave={(decision) =>
                      action("decide", { rowId: r.id, decision })
                    }
                    busy={busy}
                  />
                )}
              </details>
            </div>
          ))
        ) : (
          <div className="empty">No hay registros en este grupo.</div>
        )}
      </section>
      <div className="actions">
        {editable && (
          <button
            disabled={busy}
            className="button danger"
            onClick={() => setConfirm("discard")}
          >
            Descartar importación pendiente
          </button>
        )}
        {canRevert && (
          <button
            disabled={busy}
            className="button danger"
            onClick={() => setConfirm("revert")}
          >
            Revertir incorporación al histórico
          </button>
        )}
      </div>
    </>
  );
}
function ManualDecision({
  importId,
  mailKey,
  initialKind,
  initialStatus,
  unresolved,
  initialTarget,
  onSave,
  busy,
}: {
  importId: string;
  mailKey: string;
  initialKind: Decision["kind"];
  initialStatus?: "UNANSWERED";
  unresolved: boolean;
  initialTarget: string;
  onSave: (d: Decision) => void;
  busy: boolean;
}) {
  const [kind, setKind] = useState<Decision["kind"]>(initialKind),
    [target, setTarget] = useState(initialTarget),
    [q, setQ] = useState(""),
    [results, setResults] = useState<
      { key: string; subject: string; date: string; from: string }[]
    >([]),
    [error, setError] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "AUTO");
  return (
    <details style={{ marginTop: 18 }}>
      <summary>
        {unresolved
          ? "Resolver asociación pendiente"
          : "Corregir clasificación (opcional)"}
      </summary>
      <div className="filters" style={{ marginTop: 12 }}>
        <label>
          Clasificación
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Decision["kind"])}
          >
            <option value="REQUEST">Solicitud nueva</option>
            <option value="RESPONSE">Respuesta del personal</option>
            <option value="STAFF_SENT">Correo iniciado por personal</option>
            <option value="FOLLOWUP">Seguimiento de conversación</option>
          </select>
        </label>
        {kind === "REQUEST" && (
          <label>
            Estado de la solicitud
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="AUTO">
                Calcular a partir de las respuestas válidas
              </option>
              <option value="UNANSWERED">
                No respondida: excluir las asociaciones actuales
              </option>
            </select>
            <small>
              Una respuesta nueva aprobada posteriormente podrá cambiar el
              estado.
            </small>
          </label>
        )}
        {(kind === "RESPONSE" || kind === "FOLLOWUP") && (
          <>
            <label>
              Buscar correo original
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Asunto o remitente"
              />
            </label>
            <button
              className="button secondary"
              type="button"
              onClick={async () => {
                try {
                  const r = await fetch(
                    `/api/lookup?importId=${importId}&exclude=${mailKey}&q=${encodeURIComponent(q)}`,
                  );
                  const v = await r.json();
                  if (!r.ok) throw new Error(v.error);
                  setResults(v.rows);
                  setError("");
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "No se pudo buscar",
                  );
                }
              }}
            >
              Buscar
            </button>
            <label>
              Asociar a
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Selecciona una solicitud</option>
                {target && !results.some((r) => r.key === target) && (
                  <option value={target}>
                    Relación detectada en cabeceras
                  </option>
                )}
                {results.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.subject} · {r.from} · {dateTime(r.date)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button
          className="button secondary"
          disabled={
            busy || ((kind === "RESPONSE" || kind === "FOLLOWUP") && !target)
          }
          onClick={() =>
            onSave({
              kind,
              ...(kind === "REQUEST" && status === "UNANSWERED"
                ? { requestStatus: "UNANSWERED" as const }
                : {}),
              ...(kind === "RESPONSE" || kind === "FOLLOWUP"
                ? { targetKey: target }
                : {}),
            })
          }
        >
          Guardar decisión
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="muted" style={{ fontSize: 11 }}>
        Guardar una decisión no incorpora el correo. Después debes aprobarlo.
      </p>
    </details>
  );
}
