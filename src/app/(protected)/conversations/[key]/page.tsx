import { requireUser } from "@/lib/auth/session";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { emails, conversations } from "@/lib/db/schema";
import { PageHeading } from "@/components/page-heading";
import { EmailDetail } from "@/components/email-detail";
import { dateTime, duration, kindLabel } from "@/lib/format";
export default async function Conversation({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  await requireUser();
  const { key } = await params;
  const [e] = await db().select().from(emails).where(eq(emails.key, key));
  if (!e) notFound();
  const root = e.rootKey ?? key;
  const thread = await db()
    .select()
    .from(emails)
    .where(or(eq(emails.rootKey, root), eq(emails.key, root)))
    .orderBy(asc(emails.date));
  const [c] = await db()
    .select()
    .from(conversations)
    .where(eq(conversations.rootKey, root));
  return (
    <>
      <Link href="/conversations" className="section-link">
        ← Volver a solicitudes
      </Link>
      <div style={{ marginTop: 18 }}>
        <PageHeading
          title={e.data.subject}
          description={`${e.data.from.name || e.data.from.address} · ${dateTime(e.date)}`}
        />
      </div>
      <div className="notice">
        <b>
          {e.kind === "REVIEW"
            ? "Requiere revisión tras cambios en el histórico"
            : e.kind === "STAFF_SENT"
              ? "Correo iniciado por personal"
              : c?.firstResponseKey
                ? "Respondida"
                : "No respondida"}
        </b>{" "}
        · Primera respuesta: {duration(c?.responseSeconds ?? null)} ·{" "}
        {c?.responseCount ?? 0} respuestas válidas
      </div>
      <div className="timeline">
        {thread.map((mail, i) => (
          <article key={mail.key} className="timeline-item panel">
            <div className="panel-head">
              <div>
                <span
                  className={`badge ${mail.kind === "RESPONSE" ? "green" : ""}`}
                >
                  {i > 1 && mail.kind === "RESPONSE"
                    ? "Respuesta adicional"
                    : kindLabel[mail.kind]}
                </span>
                <h3 style={{ marginTop: 8 }}>
                  {mail.staffName ||
                    mail.data.from.name ||
                    mail.data.from.address}
                </h3>
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                {dateTime(mail.date)}
              </span>
            </div>
            <div className="panel-body">
              <EmailDetail data={mail.data} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
