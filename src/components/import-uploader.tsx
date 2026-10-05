"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { UploadCloud, FileArchive } from "lucide-react";
import { bytes } from "@/lib/format";
type Progress = {
  total: number;
  processed: number;
  errors: number;
  stage: string;
  current?: string;
  parts?: { name: string; total: number; processed: number }[];
};
export function ImportUploader({ resumeId }: { resumeId?: string }) {
  const [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [id, setId] = useState(resumeId ?? ""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [drag, setDrag] = useState(false),
    [progress, setProgress] = useState<Progress>({
      total: 0,
      processed: 0,
      errors: 0,
      stage: "",
    });
  const worker = useRef<Worker | null>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!busy) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [busy]);
  function choose(list: FileList | null) {
    const selected = Array.from(list ?? []);
    if (!selected.length) return;
    if (
      selected.length > 100 ||
      selected.some((f) => !/\.zip$/i.test(f.name)) ||
      selected.map((f) => f.name).join(" + ").length > 2000
    ) {
      setError(
        "Selecciona hasta 100 archivos ZIP con nombres que sumen menos de 2.000 caracteres",
      );
      return;
    }
    setFiles(selected);
    setError("");
    setDone(false);
  }
  function start() {
    if (!files.length) return;
    setBusy(true);
    setError("");
    setDone(false);
    worker.current = new Worker(
      new URL("../workers/email-import.worker.ts", import.meta.url),
    );
    worker.current.onmessage = (event) => {
      const m = event.data;
      if (m.type === "created") {
        setId(m.id);
        setProgress((p) => ({ ...p, parts: m.parts, total: m.total }));
      }
      if (m.type === "progress") setProgress((p) => ({ ...p, ...m }));
      if (m.type === "done") {
        setBusy(false);
        setDone(true);
        setProgress((p) => ({ ...p, ...m, stage: "Lista para revisar" }));
        worker.current?.terminate();
      }
      if (m.type === "error") {
        setBusy(false);
        setError(m.message);
        worker.current?.terminate();
      }
    };
    worker.current.onerror = () => {
      setBusy(false);
      setError(
        "El procesador se interrumpió. Puedes reanudar desde las importaciones pendientes.",
      );
      worker.current?.terminate();
    };
    worker.current.postMessage({ files, resumeId: id || undefined });
  }
  async function cancel() {
    worker.current?.terminate();
    setBusy(false);
    setProgress((p) => ({ ...p, stage: "Procesamiento cancelado" }));
    if (id) {
      try {
        const r = await fetch(`/api/imports/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pause" }),
        });
        if (!r.ok) throw new Error();
      } catch {
        setError(
          "El procesamiento local se detuvo. No se pudo confirmar la pausa en el servidor; abre la importación para recuperarla.",
        );
      }
    }
  }
  return (
    <>
      <div className="notice">
        El archivo se procesa en este navegador. Solo se guardan el texto y los
        datos de los correos en una zona pendiente de revisión. El histórico
        cambia cuando apruebas.
      </div>
      {resumeId && (
        <div className="notice warning">
          Selecciona todos los mismos ZIP para continuar. Se conservarán los
          correos ya procesados y las decisiones de revisión.
        </div>
      )}
      <section className="panel panel-body">
        <h2>Selecciona tu exportación de Zoho</h2>
        <p className="muted">
          Selecciona una o varias partes de la exportación. Se analizarán juntas
          en una única revisión al terminar todos los ZIP.
        </p>
        <div
          className={`dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!busy) choose(e.dataTransfer.files);
          }}
        >
          <UploadCloud size={40} />
          <h3>Arrastra uno o varios ZIP hasta aquí</h3>
          <p className="muted">
            Exportaciones con archivos .eml · Procesamiento local
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            Seleccionar archivos
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept=".zip,application/zip"
            hidden
            onChange={(e) => choose(e.target.files)}
          />
        </div>
        {files.length > 0 && (
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <span className="actions">
              <FileArchive size={22} />
              <span>
                <b>{files.map((f) => f.name).join(" + ")}</b>
                <br />
                <small className="muted">
                  {bytes(files.reduce((n, f) => n + f.size, 0))} ·{" "}
                  {files.length} partes
                </small>
              </span>
            </span>
            <button className="button" onClick={start} disabled={busy || done}>
              {id ? "Reanudar procesamiento" : "Procesar ZIP"}
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {(busy || progress.stage) && (
          <div style={{ marginTop: 25 }}>
            <div
              className="actions"
              style={{ justifyContent: "space-between" }}
            >
              <b>{progress.stage}</b>
              <span>
                {progress.total
                  ? Math.floor((100 * progress.processed) / progress.total)
                  : 0}
                %
              </span>
            </div>
            <progress max={progress.total || 1} value={progress.processed} />
            {progress.parts?.map((part, i) => (
              <p key={i}>
                {part.name}: {part.processed} de {part.total} mensajes
              </p>
            ))}
            <div className="muted">
              {progress.processed} de {progress.total} correos procesados ·{" "}
              {progress.errors} errores
            </div>
            <p className="preview" style={{ maxWidth: "100%" }}>
              {progress.current}
            </p>
          </div>
        )}
        <div className="actions" style={{ marginTop: 20 }}>
          {busy && (
            <button className="button danger" onClick={cancel}>
              Cancelar procesamiento
            </button>
          )}
          {id && !busy && (
            <Link className="button" href={`/import/review/${id}`}>
              Revisar importación →
            </Link>
          )}
        </div>
      </section>
      <div className="grid-two">
        <div>
          <h3>1. Procesa</h3>
          <p className="muted">
            Deja esta pestaña abierta mientras se leen los correos. Puedes
            cancelar y reanudar.
          </p>
        </div>
        <div>
          <h3>2. Revisa y aprueba</h3>
          <p className="muted">
            Comprueba las solicitudes, respuestas y cambios sobre el histórico
            antes de incorporarlos.
          </p>
        </div>
      </div>
    </>
  );
}
