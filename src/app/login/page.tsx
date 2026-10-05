import { Mail, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";
export default function Login() {
  return (
    <div className="login">
      <aside className="login-aside">
        <div className="brand">
          <span className="brand-icon">
            <Mail />
          </span>
          atención.
        </div>
        <div>
          <p className="eyebrow" style={{ color: "#7db9ac" }}>
            ATENCIÓN A AGENTES
          </p>
          <h1>
            Cada solicitud.
            <br />
            Cada respuesta.
            <br />
            Un solo histórico.
          </h1>
          <p style={{ color: "#a8c0cf", marginTop: 25, maxWidth: 360 }}>
            Organiza la atención de tu equipo con información clara, revisada y
            disponible cada día.
          </p>
        </div>
        <p className="footer-note">Control de correos · America/Caracas</p>
      </aside>
      <section className="login-form">
        <div className="login-card">
          <ShieldCheck size={29} color="#277d6a" style={{ marginBottom: 20 }} />
          <h1>Bienvenido</h1>
          <p className="muted">
            Introduce la clave para acceder al control de atención.
          </p>
          <LoginForm />
          <p className="footer-note">
            Acceso exclusivo para usuarios autorizados.
          </p>
        </div>
      </section>
    </div>
  );
}
