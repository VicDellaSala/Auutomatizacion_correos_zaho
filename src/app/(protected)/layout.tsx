import { requireUser } from "@/lib/auth/session";
import { Navigation } from "@/components/navigation";
import { Logout } from "@/components/logout";
import { Search } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <div className="shell">
      <Navigation />
      <div>
        <header className="topbar">
          <form className="global-search" action="/conversations">
            <Search size={18} />
            <input
              name="q"
              placeholder="Buscar asunto, persona o contenido…"
              aria-label="Buscar en el histórico"
            />
          </form>
          <div className="user">
            <span className="badge green">Acceso privado</span>
            <span className="avatar">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="user-name">{user.name}</span>
            <Logout />
          </div>
        </header>
        <main className="main">
          {children}
          <p className="footer-note">
            Los datos oficiales incluyen únicamente correos aprobados. Fechas
            mostradas en America/Caracas.
          </p>
        </main>
      </div>
    </div>
  );
}
