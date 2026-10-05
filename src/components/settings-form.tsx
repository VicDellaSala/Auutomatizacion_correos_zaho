"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
type Agent = { id?: string; name: string; email: string; active: boolean };
export function SettingsForm({
  mailbox: initialMailbox,
  agents: initialAgents,
}: {
  mailbox: string;
  agents: Agent[];
}) {
  const [mailbox, setMailbox] = useState(initialMailbox),
    [agents, setAgents] = useState(initialAgents),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  function change(i: number, value: Partial<Agent>) {
    setSaved(false);
    setAgents(agents.map((a, n) => (n === i ? { ...a, ...value } : a)));
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setSaved(false);
        try {
          const r = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mailbox, agents }),
          });
          const v = await r.json();
          if (!r.ok) throw new Error(v.error);
          setSaved(true);
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error de conexión");
        } finally {
          setBusy(false);
        }
      }}
    >
      <section className="panel panel-body">
        <h2>Buzón principal</h2>
        <label style={{ maxWidth: 460 }}>
          Correo del buzón controlado
          <input
            type="email"
            value={mailbox}
            onChange={(e) => {
              setMailbox(e.target.value);
              setSaved(false);
            }}
            required
          />
        </label>
      </section>
      <section className="panel panel-body">
        <h2>Miembros del equipo</h2>
        <p className="muted">
          Se reconoce al personal por la dirección del remitente.
        </p>
        {agents.map((a, i) => (
          <div className="settings-grid" key={a.id ?? i}>
            <label>
              Nombre
              <input
                value={a.name}
                onChange={(e) => change(i, { name: e.target.value })}
                required
                maxLength={200}
              />
            </label>
            <label>
              Correo
              <input
                type="email"
                value={a.email}
                onChange={(e) => change(i, { email: e.target.value })}
                required
              />
            </label>
            <label>
              Activo
              <input
                type="checkbox"
                checked={a.active}
                onChange={(e) => change(i, { active: e.target.checked })}
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          style={{ marginTop: 20 }}
          onClick={() =>
            setAgents([...agents, { name: "", email: "", active: true }])
          }
        >
          Agregar persona
        </button>
        <p className="muted" style={{ marginTop: 18, fontSize: 12 }}>
          Los cambios se aplican a correos procesados después de guardar. El
          histórico conserva la identidad reconocida al importar; desactivar a
          alguien no elimina sus respuestas anteriores.
        </p>
      </section>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {saved && (
        <p role="status" className="success">
          Configuración guardada.
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Guardando…" : "Guardar configuración"}
      </button>
    </form>
  );
}
