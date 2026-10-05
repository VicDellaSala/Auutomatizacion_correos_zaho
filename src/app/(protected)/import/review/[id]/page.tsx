import { requireUser } from "@/lib/auth/session";
import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { getImport, preview } from "@/lib/imports/service";
import { PageHeading } from "@/components/page-heading";
import { ReviewClient } from "@/components/review-client";
import { PauseImport } from "@/components/pause-import";
import { bytes, kindLabel, statusLabel } from "@/lib/format";
import { businessSeconds } from "@/lib/metrics/business-time";
export default async function Review({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  await requireUser();
  const { id } = await params;
  const q = await searchParams;
  const requestedPage = Math.max(1, Math.floor(Number(q.page) || 1));
  const imp = await getImport(db(), id);
  const entries = await db()
    .select({
      sourceFile: s.importEntries.sourceFile,
      error: s.importEntries.error,
    })
    .from(s.importEntries)
    .where(eq(s.importEntries.importId, id));
  const parts = new Map<string, { count: number; errors: number }>();
  for (const entry of entries) {
    const name =
      entry.sourceFile.match(/^\d+:\[ZIP \d+ (.*?)\]\//)?.[1] ?? imp.filename;
    const part = parts.get(name) ?? { count: 0, errors: 0 };
    part.count++;
    if (entry.error) part.errors++;
    parts.set(name, part);
  }
  const proposed = await preview(db(), id);
  const ids = [...proposed.matches]
    .filter(
      ([key, m]) =>
        !q.group ||
        m.kind === q.group ||
        (m.kind === "REQUEST" &&
          (q.group === "ANSWERED"
            ? proposed.answeredRoots.includes(key)
            : q.group === "UNANSWERED" &&
              !proposed.answeredRoots.includes(key))),
    )
    .map(([key]) => key);
  const where = and(
    eq(s.stagedEmails.importId, id),
    eq(s.stagedEmails.state, "PENDING"),
    q.focus ? eq(s.stagedEmails.id, q.focus) : undefined,
    q.group ? inArray(s.stagedEmails.key, ids) : undefined,
  );
  const [total] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.stagedEmails)
    .where(where);
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(total.count / 30)),
  );
  const rows = await db()
    .select()
    .from(s.stagedEmails)
    .where(where)
    .orderBy(s.stagedEmails.sourceFile)
    .limit(31)
    .offset((page - 1) * 30);
  const roots = [
    ...new Set(
      rows
        .map((r) => proposed.matches.get(r.key)?.rootKey)
        .filter((r): r is string => !!r),
    ),
  ];
  const originals = roots.length
    ? await db()
        .select({
          key: s.emails.key,
          data: s.emails.data,
          first: s.conversations.firstResponseKey,
        })
        .from(s.emails)
        .leftJoin(s.conversations, eq(s.conversations.rootKey, s.emails.key))
        .where(inArray(s.emails.key, roots))
    : [];
  const errors = await db()
    .select()
    .from(s.importEntries)
    .where(
      and(
        eq(s.importEntries.importId, id),
        sql`${s.importEntries.error} is not null`,
      ),
    )
    .limit(100);
  const editable = ![
    "APPROVED",
    "DISCARDED",
    "REVERTED",
    "PROCESSING",
  ].includes(imp.status);
  const readyRows = rows.slice(0, 30).map((r) => {
    const match = proposed.matches.get(r.key) ?? {
      kind: "REVIEW" as const,
      rootKey: null,
      reason: "Registro excluido del análisis pendiente",
      candidates: [],
    };
    const old = originals.find((o) => o.key === match.rootKey);
    return {
      id: r.id,
      key: r.key,
      data: r.data,
      state: r.state,
      decision: r.decision,
      attention:
        match.kind === "REQUEST"
          ? proposed.answeredRoots.includes(r.key)
            ? "Respondida"
            : "No respondida"
          : undefined,
      needsOriginal:
        !!match.rootKey &&
        match.rootKey !== r.key &&
        !originals.some((o) => o.key === match.rootKey),
      match,
      ...(old && match.kind === "RESPONSE"
        ? {
            change: {
              subject: old.data.subject,
              date: old.data.date,
              seconds: businessSeconds(old.data.date, r.data.date),
              wasAnswered: !!old.first,
              responder: r.staffName ?? r.data.from.address,
            },
          }
        : {}),
    };
  });
  return (
    <>
      <PageHeading
        title="Revisar importación"
        description={`${imp.filename} · ${bytes(imp.size)} · ${statusLabel[imp.status]}`}
      >
        <Link className="button secondary" href="/pending">
          Ver pendientes
        </Link>
      </PageHeading>
      <div className="panel panel-body">
        <b>
          {entries.length} de {imp.total} mensajes procesados
        </b>
        {[...parts].map(([name, part]) => (
          <p key={name}>
            {name}: {part.count} mensajes · {part.errors} errores
          </p>
        ))}
      </div>
      <div className="notice">
        Estos resultados son una previsualización. {proposed.changes.length}{" "}
        solicitudes históricas pasarían de no respondidas a respondidas al
        aprobar todas sus respuestas válidas.
      </div>
      {["PARTIAL", "PROCESSING", "ERROR"].includes(imp.status) && (
        <div className="notice warning">
          <p>
            La importación no ha finalizado. Puedes reanudarla seleccionando el
            mismos ZIP, o pausar para revisar lo ya guardado. El análisis será
            provisional hasta completar todas las partes.
          </p>
          <div className="actions">
            <Link className="button secondary" href={`/import?resume=${id}`}>
              Reanudar con los mismos ZIP
            </Link>
            {imp.status === "PROCESSING" && <PauseImport id={id} />}
          </div>
        </div>
      )}
      <div className="metrics">
        <Link className="metric" href="?group=ANSWERED">
          <div className="metric-label">
            Solicitudes nuevas que quedarían respondidas
          </div>
          <div className="metric-value">{proposed.answered}</div>
        </Link>
        <Link className="metric" href="?group=UNANSWERED">
          <div className="metric-label">
            Solicitudes nuevas que quedarían no respondidas
          </div>
          <div className="metric-value">{proposed.unanswered}</div>
        </Link>
        <div className="metric">
          <div className="metric-label">Resueltos automáticamente</div>
          <div className="metric-value">{proposed.automatic}</div>
        </div>
        {Object.entries(proposed.counts).map(([kind, count]) => (
          <Link className="metric" href={`?group=${kind}`} key={kind}>
            <div className="metric-label">
              {kind === "RESPONSE" ? "Respuestas realizadas" : kindLabel[kind]}
            </div>
            <div className="metric-value">{count}</div>
            <span className="section-link">Revisar grupo →</span>
          </Link>
        ))}
      </div>
      <div className="actions" style={{ marginBottom: 15 }}>
        <Link className="section-link" href="?">
          Todos los grupos
        </Link>
        {q.group && <span className="badge">{kindLabel[q.group]}</span>}
      </div>
      {errors.length > 0 && (
        <details className="panel panel-body">
          <summary>
            {errors.length === 100 ? "100 o más" : errors.length} archivos con
            error
          </summary>
          <p>No se incorporan. Puedes corregirlos y reanudar la importación.</p>
          {errors.map((e) => (
            <p
              className="muted"
              style={{ fontSize: 12, overflowWrap: "anywhere" }}
              key={e.sourceFile}
            >
              {e.sourceFile}: {e.error}
            </p>
          ))}
          <a className="link" href={`/api/imports/${id}/errors`}>
            Descargar listado completo
          </a>
        </details>
      )}
      <ReviewClient
        key={`${q.group ?? "all"}-${page}-${JSON.stringify(readyRows.map((r) => [r.id, r.match, r.decision]))}`}
        id={id}
        rows={readyRows}
        editable={editable}
        canRevert={!!imp.approvedAt && imp.status !== "REVERTED"}
        focus={q.focus}
      />
      <div className="pagination">
        <span>Página {page} · hasta 30 registros</span>
        <div className="actions">
          {page > 1 && (
            <Link
              className="button secondary"
              href={`?${new URLSearchParams({ ...q, page: String(page - 1) })}`}
            >
              Anterior
            </Link>
          )}
          {rows.length > 30 && (
            <Link
              className="button secondary"
              href={`?${new URLSearchParams({ ...q, page: String(page + 1) })}`}
            >
              Siguiente
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
