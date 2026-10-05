"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const data = new FormData(e.currentTarget);
        try {
          const r = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(data)),
          });
          const v = await r.json();
          if (!r.ok) throw new Error(v.error);
          router.replace("/dashboard");
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error de conexión");
          setBusy(false);
        }
      }}
    >
      <label>
        Clave de acceso
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          maxLength={1024}
          required
        />
      </label>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Ingresando…" : "Iniciar sesión"}
      </button>
    </form>
  );
}
