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
  const page = Math.max(1, Number(q.page) || 1);
  const imp = await getImport(db(), id);
  const proposed = await preview(db(), id);
  const ids = [...proposed.matches]
    .filter(([, m]) => !q.group || m.kind === q.group)
    .map(([key]) => key);
  const where = and(
    eq(s.stagedEmails.importId, id),
    q.group ? inArray(s.stagedEmails.key, ids) : undefined,
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
      match,
      ...(old && match.kind === "RESPONSE"
        ? {
            change: {
              subject: old.data.subject,
              date: old.data.date,
              seconds:
                (Date.parse(r.data.date) - Date.parse(old.data.date)) / 1000,
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
      <div className="notice">
        Estos resultados son una previsualización. {proposed.changes.length}{" "}
        solicitudes históricas pasarían de no respondidas a respondidas al
        aprobar todas sus respuestas válidas.
      </div>
      {["PARTIAL", "PROCESSING", "ERROR"].includes(imp.status) && (
        <div className="notice warning">
          <p>
            La importación no ha finalizado. Puedes reanudarla seleccionando el
            mismo ZIP, o pausar para revisar lo ya guardado.
          </p>
          <div className="actions">
            <Link className="button secondary" href={`/import?resume=${id}`}>
              Reanudar con el mismo ZIP
            </Link>
            {imp.status === "PROCESSING" && <PauseImport id={id} />}
          </div>
        </div>
      )}
      <div className="metrics">
        {Object.entries(proposed.counts).map(([kind, count]) => (
          <Link className="metric" href={`?group=${kind}`} key={kind}>
            <div className="metric-label">{kindLabel[kind]}</div>
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
        key={`${q.group ?? "all"}-${page}`}
        id={id}
        rows={readyRows}
        editable={editable}
        canRevert={!!imp.approvedAt && imp.status !== "REVERTED"}
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
