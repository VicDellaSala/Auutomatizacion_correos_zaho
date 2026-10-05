"use client";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function Logout() {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <>
      <button
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        onClick={async () => {
          try {
            const r = await fetch("/api/auth/logout", { method: "POST" });
            if (!r.ok) throw new Error();
            router.replace("/login");
            router.refresh();
          } catch {
            setError("No se pudo cerrar sesión");
          }
        }}
      >
        <LogOut size={16} />
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
