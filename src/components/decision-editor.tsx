"use client";
import { useState } from "react";
import type { Decision } from "@/types/email";
import { dateTime } from "@/lib/format";
export function DecisionEditor({
  mailKey,
  importId,
  initial,
  people = [],
  onSave,
  busy = false,
  open = false,
  official = false,
}: {
  mailKey: string;
  importId?: string;
  initial: Decision;
  people?: { id: string; name: string }[];
  onSave: (d: Decision) => void;
  busy?: boolean;
  open?: boolean;
  official?: boolean;
}) {
  const [kind, setKind] = useState(initial.kind),
    [status, setStatus] = useState<
      NonNullable<Decision["requestStatus"]> | "AUTO"
    >(initial.requestStatus ?? "AUTO"),
    [ignored, setIgnored] = useState(initial.ignored ?? false),
    [reason, setReason] = useState(initial.ignoredReason ?? ""),
    [responsible, setResponsible] = useState(initial.responsibleId ?? ""),
    [additional, setAdditional] = useState(
      initial.manualResponseAdditional ?? false,
    ),
    [target, setTarget] = useState(initial.targetKey ?? ""),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [results, setResults] = useState<
    { key: string; subject: string; date: string; from: string }[]
  >([]);
  return (
    <details open={open ? true : undefined} style={{ marginTop: 18 }}>
      <summary>
        {official
          ? "Editar clasificación y estado"
          : "Corregir clasificación (opcional) / resolver asociación"}
      </summary>
      <div className="filters" style={{ marginTop: 12 }}>
        <label>
          Clasificación
          <select
            aria-label="Clasificación"
            value={kind}
            disabled={busy}
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
            <select
              aria-label="Estado de la solicitud"
              value={status}
              disabled={busy}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="AUTO">Automático según respuestas y hora</option>
              <option value="ANSWERED">Respondida manualmente</option>
              <option value="UNANSWERED">No respondida</option>
              <option value="AFTER_HOURS">Pendiente fuera del horario</option>
            </select>
            <small>
              Una respuesta real aprobada posteriormente puede cambiar el
              estado. No se crean respuestas ficticias.
            </small>
          </label>
        )}
        <label>
          Responsable
          <select
            aria-label="Responsable"
            value={responsible}
            disabled={busy}
            onChange={(e) => setResponsible(e.target.value)}
          >
            <option value="">Automático / sin ajuste</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {kind === "REQUEST" && status === "ANSWERED" && (
          <label>
            <input
              type="checkbox"
              checked={additional}
              disabled={busy}
              onChange={(e) => setAdditional(e.target.checked)}
            />
            La atención manual es adicional a las respuestas por correo
            <small>
              Por defecto, un correo acreditado al mismo responsable sustituye
              la acreditación manual. Marca esto solo si fueron gestiones
              distintas. Sin responsable se mostrará «Sin asignar».
            </small>
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={ignored}
            disabled={busy}
            onChange={(e) => setIgnored(e.target.checked)}
          />{" "}
          Ignorar (conservar fuera de métricas)
        </label>
        {ignored && (
          <label>
            Motivo de ignorado
            <input
              value={reason}
              maxLength={2000}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        {(kind === "RESPONSE" || kind === "FOLLOWUP") && (
          <>
            <label>
              Buscar correo original
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Asunto o remitente"
              />
            </label>
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  const r = await fetch(
                    `/api/lookup?${new URLSearchParams({ ...(importId ? { importId } : {}), exclude: mailKey, q: query })}`,
                  );
                  const v = await r.json();
                  if (!r.ok) throw new Error(v.error);
                  setResults(v.rows);
                  setError("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Error al buscar");
                }
              }}
            >
              Buscar
            </button>
            <label>
              Asociar a
              <select
                aria-label="Asociar a"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">
                  {kind === "RESPONSE"
                    ? "Sin asociación"
                    : "Selecciona el original"}
                </option>
                {target && !results.some((r) => r.key === target) && (
                  <option value={target}>Asociación actual</option>
                )}
                {results.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.subject} · {r.from} · {dateTime(r.date)}
                  </option>
                ))}
              </select>
            </label>
            {kind === "RESPONSE" && !target && (
              <p>
                Si no se encuentra un original compatible, se contabiliza como
                respuesta sin asociación y no marca ninguna solicitud como
                respondida. Podrá asociarse cuando se incorpore su original.
              </p>
            )}
          </>
        )}
        <button
          className="button"
          disabled={busy || (!ignored && kind === "FOLLOWUP" && !target)}
          onClick={() =>
            onSave({
              kind,
              ignored,
              ignoredReason: reason,
              ...(kind === "REQUEST" && status === "ANSWERED"
                ? { manualResponseAdditional: additional }
                : {}),
              ...(responsible ? { responsibleId: responsible } : {}),
              ...(kind === "REQUEST" && status !== "AUTO"
                ? { requestStatus: status }
                : {}),
              ...((kind === "RESPONSE" || kind === "FOLLOWUP") && target
                ? { targetKey: target }
                : {}),
            })
          }
        >
          {official ? "Guardar cambios" : "Guardar decisión"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="muted">
        {official
          ? "La corrección quedará registrada en auditoría y actualizará el histórico y sus métricas."
          : "Guardar no incorpora el correo. Después debes aprobarlo."}
      </p>
    </details>
  );
}
