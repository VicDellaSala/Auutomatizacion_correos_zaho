import { requireUser } from "@/lib/auth/session";
import Link from "next/link";
import {
  Download,
  Plus,
  Mail,
  CheckCheck,
  Clock,
  Percent,
  Timer,
} from "lucide-react";
import { db } from "@/lib/db";
import { metrics, mailList } from "@/lib/metrics/query";
import { duration } from "@/lib/format";
import { Filters } from "@/components/filters";
import { MailTable } from "@/components/mail-table";
import { PageHeading } from "@/components/page-heading";
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireUser();
  const f = await searchParams;
  const m = await metrics(db(), f);
  const { rows } = await mailList(db(), f, 6);
  const query = new URLSearchParams(f).toString();
  return (
    <>
      <PageHeading
        title="Resumen general"
        description="Una visión clara de la atención de tu equipo."
      >
        <a className="button secondary" href={`/api/reports?${query}`}>
          <Download size={15} />
          Reporte HTML
        </a>
        <Link className="button" href="/import">
          <Plus size={16} />
          Importar correos
        </Link>
      </PageHeading>
      <Filters />
      {m.pending > 0 && (
        <div className="notice">
          Hay {m.pending} correos pendientes de revisión. Todavía no afectan
          este resumen.{" "}
          <Link className="section-link" href="/pending">
            Revisar importaciones →
          </Link>
        </div>
      )}
      <section className="metrics">
        {[
          ["Solicitudes recibidas", m.received, "Total del período", Mail],
          ["Respondidas", m.answered, "Con respuesta válida", CheckCheck],
          [
            "Respuestas realizadas",
            m.responses,
            "Todos los mensajes de respuesta",
            Mail,
          ],
          ["No respondidas", m.unanswered, "Pendientes de atención", Clock],
          [
            "Pendientes fuera del horario",
            m.afterHours,
            "Recepción desde las 16:50",
            Clock,
          ],
          ["Ignorados", m.ignored, "Excluidos de métricas", Mail],
          [
            "Tasa de respuesta",
            `${m.rate.toFixed(1)}%`,
            `Sobre ${m.evaluated} solicitudes evaluadas; excluye pendientes e ignorados`,
            Percent,
          ],
          [
            "Tiempo promedio",
            m.answered ? duration(m.average) : "—",
            "Primera respuesta · 08:00–17:00",
            Timer,
          ],
        ].map(([label, value, note, Icon]) => {
          const I = Icon as typeof Mail;
          return (
            <div className="metric" key={String(label)}>
              <div className="metric-label">
                {String(label)}
                <I size={15} />
              </div>
              <div className="metric-value">{String(value)}</div>
              <div className="metric-note">{String(note)}</div>
            </div>
          );
        })}
      </section>
      <div className="grid-two">
        <section className="panel">
          <div className="panel-head">
            <h2>Respuestas por persona</h2>
            <span className="muted" style={{ fontSize: 11 }}>
              Respuestas a solicitudes
            </span>
          </div>
          <div className="panel-body">
            {m.team.length ? (
              m.team.map((p) => (
                <Link
                  href={`/responses?${query}&person=${encodeURIComponent(p.name)}`}
                  className="bar-row"
                  key={p.name}
                >
                  <span className="name">{p.name}</span>
                  <span className="bar-track">
                    <span
                      className="bar-fill"
                      style={{
                        display: "block",
                        width: `${(100 * p.responses) / Math.max(...m.team.map((a) => a.responses))}%`,
                      }}
                    />
                  </span>
                  <b>{p.responses}</b>
                  <small title="Promedio desde la solicitud hasta cada respuesta, en horario operativo">
                    {duration(p.average)}
                  </small>
                </Link>
              ))
            ) : (
              <div className="empty">
                Las respuestas aparecerán aquí después de aprobarlas.
              </div>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Correos iniciados por personal</h2>
            <Link className="section-link" href="/staff-sent">
              Ver todos →
            </Link>
          </div>
          <div className="panel-body">
            {m.initiated.length ? (
              m.initiated.map((p) => (
                <Link
                  href={`/staff-sent?${query}&person=${encodeURIComponent(p.name)}`}
                  key={p.name}
                  className="bar-row"
                >
                  <span style={{ flex: 1 }}>{p.name}</span>
                  <b>{p.count}</b>
                </Link>
              ))
            ) : (
              <div className="empty">
                Sin correos iniciados en este período.
              </div>
            )}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Solicitudes recientes</h2>
          <Link href={`/conversations?${query}`} className="section-link">
            Ver todas las solicitudes →
          </Link>
        </div>
        <MailTable rows={rows} />
      </section>
      <p className="muted" style={{ fontSize: 11 }}>
        Las métricas siguen la fecha de recepción de la solicitud e incluyen sus
        respuestas aprobadas, aunque hayan llegado después del período filtrado.
        Las respuestas sin asociación usan su fecha de envío y no generan
        tiempos ni solicitudes respondidas. Pendientes fuera del horario e
        ignorados no reducen la tasa.
      </p>
    </>
  );
}
