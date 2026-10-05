"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  ClipboardCheck,
  CheckCheck,
  Clock,
  Send,
  History,
  Settings,
  Mail,
} from "lucide-react";
const links = [
  ["/dashboard", "Resumen general", LayoutDashboard],
  ["/import", "Importar correos", Upload],
  ["/pending", "Revisar importaciones", ClipboardCheck],
  ["/answered", "Solicitudes respondidas", CheckCheck],
  ["/unanswered", "No respondidas", Clock],
  ["/staff-sent", "Enviados por personal", Send],
  ["/history", "Historial de importaciones", History],
  ["/settings", "Configuración", Settings],
] as const;
export function Navigation() {
  const path = usePathname();
  return (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand">
        <span className="brand-icon">
          <Mail size={21} />
        </span>
        atención<span style={{ color: "#75b2a6" }}>.</span>
      </Link>
      <div className="nav-label">CONTROL DE CORREOS</div>
      <nav>
        {links.map(([href, label, Icon]) => (
          <Link
            key={href}
            href={href}
            className={`nav-link ${path === href ? "active" : ""}`}
          >
            <Icon size={17} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div style={{ color: "#b7cbd9", marginBottom: 5 }}>
          Atención a agentes
        </div>
        Histórico de correos aprobados
        <br />
        America/Caracas · UTC−4
      </div>
    </aside>
  );
}
