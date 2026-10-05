import Link from "next/link";
import { db } from "@/lib/db";
import { mailList } from "@/lib/metrics/query";
import { PageHeading } from "./page-heading";
import { Filters } from "./filters";
import { MailTable } from "./mail-table";
export async function ListPage({
  title,
  view,
  params,
}: {
  title: string;
  view: string;
  params: Record<string, string>;
}) {
  const page = Math.max(1, Number(params.page) || 1);
  const result = await mailList(db(), { ...params, page, view });
  const link = (n: number) =>
    `?${new URLSearchParams({ ...params, page: String(n) })}`;
  return (
    <>
      <PageHeading
        title={title}
        description={
          params.person
            ? `Persona: ${params.person}`
            : params.q
              ? `Resultados para “${params.q}”`
              : "Consulta el histórico aprobado y abre cada conversación."
        }
      />
      <Filters />
      {params.q && (
        <form className="filters">
          <input name="q" defaultValue={params.q} aria-label="Búsqueda" />
          <button className="button secondary">Buscar</button>
        </form>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>{result.count} registros</h2>
        </div>
        <MailTable rows={result.rows} />
        <div className="pagination">
          <span>
            Página {page} de {Math.max(1, Math.ceil(result.count / 40))}
          </span>
          <div className="actions">
            {page > 1 && (
              <Link className="button secondary small" href={link(page - 1)}>
                Anterior
              </Link>
            )}
            {page * 40 < result.count && (
              <Link className="button secondary small" href={link(page + 1)}>
                Siguiente
              </Link>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
