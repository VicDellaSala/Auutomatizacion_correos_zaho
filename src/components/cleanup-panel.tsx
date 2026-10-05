"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { dateTime } from "@/lib/format";
type Plan = {
  token: string;
  from: string;
  to: string;
  totals: {
    imports: number;
    emails: number;
    affectedEmails: number;
    staged: number;
    requests: number;
    responses: number;
    shared: number;
  };
  imports: { id: string; filename: string; createdAt: string }[];
};
export function CleanupPanel() {
  const router = useRouter();
  const [mode, setMode] = useState("today"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [plan, setPlan] = useState<Plan | null>(null),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const timed = mode === "time" || mode === "time-range";
  const range = mode === "range" || mode === "time-range";
  function interval() {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Caracas",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const a = mode === "today" ? today : from;
    const b = range ? to : a;
    if (!a || !b) throw new Error("Completa la fecha y el intervalo");
    const start = new Date(`${a}${timed ? ":00" : "T00:00:00"}-04:00`);
    const last = new Date(`${b}${timed ? ":00" : "T00:00:00"}-04:00`);
    return {
      from: start.toISOString(),
      to: new Date(+last + (timed ? 60000 : 86400000)).toISOString(),
    };
  }
  async function run(commit: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/cleanup/${commit ? "commit" : "preview"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commit ? { ...plan, confirm } : interval()),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (commit) {
        setPlan(null);
        setConfirm("");
        setMessage("Limpieza completada. Histórico y métricas recalculados.");
        router.refresh();
      } else {
        setPlan(data);
        setConfirm("");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo completar");
      if (commit) setPlan(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel panel-body">
      <h2>Limpiar datos importados</h2>
      <p>
        Selecciona cuándo se subieron los archivos, en America/Caracas. La fecha
        interna de los correos no interviene. La hora final incluye el minuto
        seleccionado.
      </p>
      <div className="filters">
        <label>
          Intervalo
          <select
            disabled={busy}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setFrom("");
              setTo("");
              setPlan(null);
            }}
          >
            <option value="today">Hoy</option>
            <option value="date">Fecha específica</option>
            <option value="range">Rango de fechas</option>
            <option value="time">Fecha y hora (un minuto)</option>
            <option value="time-range">Rango fecha/hora</option>
          </select>
        </label>
        {mode !== "today" && (
          <label>
            Desde
            <input
              disabled={busy}
              type={timed ? "datetime-local" : "date"}
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPlan(null);
              }}
            />
          </label>
        )}
        {range && (
          <label>
            Hasta
            <input
              disabled={busy}
              type={timed ? "datetime-local" : "date"}
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPlan(null);
              }}
            />
          </label>
        )}
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => run(false)}
        >
          Previsualizar limpieza
        </button>
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {plan && (
        <div className="notice warning">
          <p>
            Se eliminarán {plan.totals.imports} importaciones entre{" "}
            {dateTime(plan.from)} y {dateTime(plan.to)} (límite final
            exclusivo).
          </p>
          <p>
            Correos afectados: {plan.totals.affectedEmails}. Se borrarán del
            histórico: {plan.totals.emails} · Solicitudes:{" "}
            {plan.totals.requests} · Respuestas: {plan.totals.responses} ·
            Registros de revisión: {plan.totals.staged}.
          </p>
          <p>
            Se conservarán {plan.totals.shared} correos compartidos con otras
            importaciones, así como configuración, personal y acceso.
          </p>
          <ul>
            {plan.imports.map((i) => (
              <li key={i.id}>
                {i.filename} · {dateTime(i.createdAt)}
              </li>
            ))}
          </ul>
          <label>
            Escribe ELIMINAR para confirmar
            <input
              disabled={busy}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button
            className="button danger"
            disabled={busy || confirm !== "ELIMINAR" || !plan.totals.imports}
            onClick={() => run(true)}
          >
            Eliminar importaciones indicadas
          </button>
        </div>
      )}
    </section>
  );
}
