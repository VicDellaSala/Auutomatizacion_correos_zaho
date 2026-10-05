"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
async function request(path: string, body?: unknown, method = "POST") {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error);
  return v;
}
export function BackupPanel() {
  const router = useRouter(),
    [id, setId] = useState(""),
    [counts, setCounts] = useState<Record<string, number> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [confirm, setConfirm] = useState("");
  async function inspect(file: File) {
    setBusy(true);
    setError("");
    setCounts(null);
    setStatus("Validando respaldo…");
    let newId = "";
    try {
      if (id) await request(`/api/restore/${id}`, undefined, "DELETE");
      const job = await request("/api/restore");
      newId = job.id;
      setId(newId);
      const reader = file
        .stream()
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "",
        line = 0,
        header = false,
        ended = false;
      let batch: { line: number; table: string; data: unknown }[] = [];
      let bytes = 0;
      let totals: Record<string, number> | null = null;
      const flush = async () => {
        if (batch.length) {
          await request(`/api/restore/${newId}/batch`, { rows: batch });
          batch = [];
          bytes = 0;
          setStatus(`${line} registros validados…`);
        }
      };
      const processLine = async (text: string) => {
        if (!text.trim()) return;
        if (ended)
          throw new Error("Datos inesperados después del cierre del respaldo");
        const value = JSON.parse(text);
        if (!header) {
          if (value.format !== "atencion-backup" || value.version !== 1)
            throw new Error("Formato de respaldo no reconocido");
          header = true;
          return;
        }
        if (value.end) {
          totals = value.counts;
          ended = true;
          return;
        }
        const size = new TextEncoder().encode(text).byteLength;
        if (size > 2900000)
          throw new Error("Registro demasiado grande para restauración segura");
        if (bytes + size > 750000) await flush();
        batch.push({ line: line++, table: value.table, data: value.data });
        bytes += size;
        if (batch.length >= 100) await flush();
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          let split;
          while ((split = buffer.indexOf("\n")) >= 0) {
            await processLine(buffer.slice(0, split));
            buffer = buffer.slice(split + 1);
          }
          if (buffer.length > 3000000)
            throw new Error("Línea de respaldo demasiado grande");
        }
        if (buffer.trim()) await processLine(buffer);
      } finally {
        await reader.cancel();
      }
      if (!ended || !totals)
        throw new Error("Respaldo incompleto: falta el cierre de verificación");
      await flush();
      const summary = await request(`/api/restore/${newId}/finish`, {
        counts: totals,
      });
      setCounts(summary.counts);
      setStatus("Respaldo validado. Revisa el resumen antes de confirmar.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo validar el archivo",
      );
      setStatus("");
      if (newId) {
        try {
          await request(`/api/restore/${newId}`, undefined, "DELETE");
          setId("");
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel panel-body" style={{ marginTop: 30 }}>
      <h2>Respaldo y restauración</h2>
      <p className="muted">
        El respaldo contiene el histórico, importaciones, staging, miembros y
        configuración. Las conversaciones se reconstruyen al restaurar. Las
        cuentas de acceso permanecen en esta instalación.
      </p>
      <a className="button secondary" href="/api/backup" download>
        Exportar respaldo JSONL
      </a>
      <hr style={{ borderColor: "#e4eaee", margin: "25px 0" }} />
      <label>
        Validar un respaldo
        <input
          type="file"
          accept=".jsonl,.ndjson"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void inspect(file);
          }}
        />
      </label>
      {status && (
        <p role="status" className="notice" style={{ marginTop: 15 }}>
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {counts && (
        <div className="notice warning">
          <h3>Resumen de restauración</h3>
          <ul>
            {Object.entries(counts).map(([name, count]) => (
              <li key={name}>
                {name}: {count}
              </li>
            ))}
          </ul>
          <p>
            <b>
              Esta operación reemplazará el histórico, los pendientes, el equipo
              y la configuración actuales.
            </b>{" "}
            Exporta primero un respaldo si deseas conservarlos.
          </p>
          <label>
            Escribe RESTAURAR para confirmar
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="actions" style={{ marginTop: 15 }}>
            <button
              className="button danger"
              disabled={busy || confirm !== "RESTAURAR"}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await request(`/api/restore/${id}/commit`, { confirm });
                  setCounts(null);
                  setId("");
                  setConfirm("");
                  setStatus("Restauración completada.");
                  router.refresh();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "No se pudo restaurar",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Restaurando…" : "Confirmar restauración"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  await request(`/api/restore/${id}`, undefined, "DELETE");
                  setId("");
                  setCounts(null);
                  setStatus("Restauración cancelada.");
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "No se pudo cancelar",
                  );
                }
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
