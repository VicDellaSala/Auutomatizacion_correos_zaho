"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DecisionEditor } from "./decision-editor";
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
    previousState: string;
    responder: string;
  };
};
export function ReviewClient({
  id,
  rows,
  editable,
  canRevert,
  focus,
  people,
}: {
  id: string;
  rows: ReviewRow[];
  editable: boolean;
  canRevert: boolean;
  focus?: string;
  people: { id: string; name: string }[];
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
              className="button secondary small"
              disabled={busy}
              onClick={() => router.refresh()}
            >
              Reanalizar importación
            </button>
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
                      : r.decision?.ignored
                        ? "Ignorado"
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
                      Estado actual: {r.change.previousState}
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
                  <DecisionEditor
                    importId={id}
                    mailKey={r.key}
                    people={people}
                    initial={{
                      ...r.decision,
                      kind:
                        r.match.kind === "REVIEW"
                          ? (r.decision?.kind ?? "REQUEST")
                          : r.match.kind,
                      ...(r.match.rootKey && r.match.rootKey !== r.key
                        ? { targetKey: r.match.rootKey }
                        : {}),
                    }}
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
