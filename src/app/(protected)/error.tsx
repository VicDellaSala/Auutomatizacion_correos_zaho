"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="panel panel-body">
      <h1>No se pudo cargar la información</h1>
      <p>
        Comprueba que PostgreSQL esté disponible, las migraciones se hayan
        ejecutado y las variables de entorno estén configuradas.
      </p>
      <button className="button" onClick={reset}>
        Volver a intentar
      </button>
    </div>
  );
}
