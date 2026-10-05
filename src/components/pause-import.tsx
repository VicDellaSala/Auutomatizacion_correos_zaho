"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
export function PauseImport({ id }: { id: string }) {
  const router = useRouter(),
    [error, setError] = useState("");
  return (
    <>
      <button
        className="button secondary"
        onClick={async () => {
          try {
            const r = await fetch(`/api/imports/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "pause" }),
            });
            const v = await r.json();
            if (!r.ok) throw new Error(v.error);
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo pausar");
          }
        }}
      >
        Pausar y revisar lo guardado
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
