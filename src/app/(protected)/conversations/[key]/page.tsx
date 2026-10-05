import { requireUser } from "@/lib/auth/session";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, or, inArray, and } from "drizzle-orm";
import { businessSeconds } from "@/lib/metrics/business-time";
import { db } from "@/lib/db";
import {
  emails,
  conversations,
  emailImports,
  imports,
  stagedEmails,
} from "@/lib/db/schema";
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
  const original = thread.find((m) => m.key === root) ?? e;
  const sources = await db()
    .select({
      key: emailImports.emailKey,
      id: imports.id,
      filename: imports.filename,
      createdAt: imports.createdAt,
    })
    .from(emailImports)
    .innerJoin(imports, eq(imports.id, emailImports.importId))
    .where(
      inArray(
        emailImports.emailKey,
        thread.map((m) => m.key),
      ),
    );
  const sourceFiles = await db()
    .select({ key: stagedEmails.key, sourceFile: stagedEmails.sourceFile })
    .from(stagedEmails)
    .where(
      and(
        eq(stagedEmails.state, "APPROVED"),
        inArray(
          stagedEmails.key,
          thread.map((m) => m.key),
        ),
      ),
    );
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
        · Primera respuesta:{" "}
        {duration(
          c?.firstResponseAt
            ? businessSeconds(original.date, c.firstResponseAt)
            : null,
        )}{" "}
        · 08:00–17:00 America/Caracas · {c?.responseCount ?? 0} respuestas
        válidas
      </div>
      <div className="timeline">
        {thread.map((mail) => (
          <article key={mail.key} className="timeline-item panel">
            <div className="panel-head">
              <div>
                <span
                  className={`badge ${mail.kind === "RESPONSE" ? "green" : ""}`}
                >
                  {mail.key !== c?.firstResponseKey && mail.kind === "RESPONSE"
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
              {mail.kind === "RESPONSE" && (
                <p>
                  Tiempo operativo desde la solicitud:{" "}
                  {duration(businessSeconds(original.date, mail.date))}
                </p>
              )}
              <p>
                Origen:{" "}
                {sources
                  .filter((p) => p.key === mail.key)
                  .map((p) => (
                    <span key={p.id}>
                      {p.filename} · Importado {dateTime(p.createdAt)}{" "}
                    </span>
                  ))}
              </p>
              <p className="muted">
                {sourceFiles
                  .filter((p) => p.key === mail.key)
                  .map((p) => p.sourceFile)
                  .join(" · ")}
              </p>
              <EmailDetail data={mail.data} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
