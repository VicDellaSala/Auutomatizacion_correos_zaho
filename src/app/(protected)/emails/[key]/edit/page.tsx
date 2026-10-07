import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { emails, agents } from "@/lib/db/schema";
import { correctionVersion } from "@/lib/emails/service";
import { PageHeading } from "@/components/page-heading";
import { EmailDetail } from "@/components/email-detail";
import { ApprovedEditor } from "@/components/approved-editor";
import { dateTime } from "@/lib/format";
export default async function Edit({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ target?: string }>;
}) {
  await requireUser();
  const { key } = await params;
  const { target } = await searchParams;
  const [mail] = await db().select().from(emails).where(eq(emails.key, key));
  if (!mail) notFound();
  const people = await db()
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .orderBy(agents.name);
  const initial = {
    ...mail.decision,
    kind:
      mail.kind === "REVIEW"
        ? mail.staffName
          ? ("STAFF_SENT" as const)
          : ("REQUEST" as const)
        : mail.kind,
    ...(mail.rootKey && mail.rootKey !== mail.key
      ? { targetKey: mail.rootKey }
      : {}),
    ...(target && mail.staffName
      ? { kind: "RESPONSE" as const, targetKey: target }
      : {}),
  };
  return (
    <>
      <PageHeading
        title="Editar correo aprobado"
        description={mail.data.subject}
      >
        <Link className="button secondary" href={`/conversations/${key}`}>
          Ver detalle
        </Link>
      </PageHeading>
      <ApprovedEditor
        mailKey={key}
        version={correctionVersion(mail)}
        initial={initial}
        people={people}
      />
      <section className="panel panel-body">
        <EmailDetail data={mail.data} />
      </section>
      <details className="panel panel-body">
        <summary>
          Auditoría de correcciones ({mail.decision?.audit?.length ?? 0})
        </summary>
        {[...(mail.decision?.audit ?? [])].reverse().map((entry, i) => (
          <div key={i}>
            <p>
              {dateTime(entry.at)} · {entry.userName}
            </p>
            <details>
              <summary>Valores anterior y nuevo</summary>
              <pre className="email-content">
                {JSON.stringify(
                  { anterior: entry.before, nuevo: entry.after },
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        ))}
      </details>
    </>
  );
}
