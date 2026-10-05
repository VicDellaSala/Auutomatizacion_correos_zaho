import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bytes, dateTime, statusLabel } from "@/lib/format";
import { PageHeading } from "./page-heading";
type Row = {
  id: string;
  filename: string;
  size: number;
  status: string;
  createdAt: string;
  total: number;
  approvedBy: string | null;
  approvedAt: string | null;
  approved: number;
  rejected: number;
  pending: number;
  errors: number;
};
export async function ImportHistory({
  pending = false,
  page = 1,
}: {
  pending?: boolean;
  page?: number;
}) {
  const where = pending
    ? sql`where i.status in ('PROCESSING','PARTIAL','READY_FOR_REVIEW','PARTIALLY_APPROVED','ERROR')`
    : sql``;
  const result = await db().execute(
    sql`select i.*,(select count(*)::int from staged_emails s where s."importId"=i.id and s.state='APPROVED') approved,(select count(*)::int from staged_emails s where s."importId"=i.id and s.state='REJECTED') rejected,(select count(*)::int from staged_emails s where s."importId"=i.id and s.state='PENDING') pending,(select count(*)::int from import_entries e where e."importId"=i.id and e.error is not null) errors from imports i ${where} order by i."createdAt" desc limit 31 offset ${(page - 1) * 30}`,
  );
  const rows = result.rows as Row[];
  return (
    <>
      <PageHeading
        title={
          pending ? "Pendientes de revisión" : "Historial de importaciones"
        }
        description="Cada archivo conserva su procedencia y sus decisiones de aprobación."
      >
        <Link href="/import" className="button">
          Importar correos
        </Link>
      </PageHeading>
      <section className="panel">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Archivo / fecha</th>
                  <th>Estado</th>
                  <th>Correos</th>
                  <th>Aprobados</th>
                  <th>Rechazados</th>
                  <th>Errores</th>
                  <th>Aprobación</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 30).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="subject" href={`/import/review/${r.id}`}>
                        {r.filename}
                      </Link>
                      <div className="muted">
                        {dateTime(r.createdAt)} · {bytes(Number(r.size))}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${r.status === "APPROVED" ? "green" : "amber"}`}
                      >
                        {statusLabel[r.status]}
                      </span>
                    </td>
                    <td>
                      {r.total}
                      <div className="muted">{r.pending} pendientes</div>
                    </td>
                    <td>{r.approved}</td>
                    <td>{r.rejected}</td>
                    <td>{r.errors}</td>
                    <td>
                      {r.approvedBy || "—"}
                      <div className="muted">{dateTime(r.approvedAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>
              {pending
                ? "No hay importaciones pendientes"
                : "Aún no hay importaciones"}
            </strong>
            Los archivos que proceses aparecerán aquí.
          </div>
        )}
        <div className="pagination">
          <span>Página {page}</span>
          <div className="actions">
            {page > 1 && (
              <Link
                href={`?page=${page - 1}`}
                className="button secondary small"
              >
                Anterior
              </Link>
            )}
            {rows.length > 30 && (
              <Link
                href={`?page=${page + 1}`}
                className="button secondary small"
              >
                Siguiente
              </Link>
            )}
          </div>
        </div>
      </section>
      {!pending && (
        <Link className="section-link" href="/conversations?view=review">
          Ver correos oficiales que requieren revisión tras una reversión →
        </Link>
      )}
    </>
  );
}
