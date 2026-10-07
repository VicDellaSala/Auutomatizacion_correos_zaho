"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Decision } from "@/types/email";
import { DecisionEditor } from "./decision-editor";
export function ApprovedEditor({
  mailKey,
  version,
  initial,
  people,
}: {
  mailKey: string;
  version: string;
  initial: Decision;
  people: { id: string; name: string }[];
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [query, setQuery] = useState("");
  const [responses, setResponses] = useState<
    { key: string; subject: string; from: string }[]
  >([]);
  async function save(decision: Decision) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const r = await fetch(`/api/emails/${mailKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, version }),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel panel-body">
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {saved && <p role="status">Cambio guardado. Métricas actualizadas.</p>}
      <DecisionEditor
        key={version}
        mailKey={mailKey}
        initial={initial}
        people={people}
        busy={busy}
        open
        official
        onSave={save}
      />
      {initial.kind === "REQUEST" && (
        <details style={{ marginTop: 20 }}>
          <summary>Asociar una respuesta existente</summary>
          <p>
            Busca el mensaje del personal y abre su edición con esta solicitud
            como original.
          </p>
          <div className="filters">
            <label>
              Buscar respuesta
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  const r = await fetch(
                    `/api/lookup?${new URLSearchParams({ exclude: mailKey, q: query, responses: "true" })}`,
                  );
                  const v = await r.json();
                  if (!r.ok) throw new Error(v.error);
                  setResponses(v.rows);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "No se pudo buscar",
                  );
                }
              }}
            >
              Buscar respuestas
            </button>
          </div>
          {responses.map((r) => (
            <p key={r.key}>
              <a
                className="section-link"
                href={`/emails/${r.key}/edit?target=${mailKey}`}
              >
                {r.subject} · {r.from} · Asociar y revisar →
              </a>
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
