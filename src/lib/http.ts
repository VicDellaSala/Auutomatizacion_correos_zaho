import { z } from "zod";
import { DomainError } from "@/lib/imports/service";
import { AccessConfigurationError } from "@/lib/auth/shared-access";
export async function readJson(request: Request) {
  const limit = 3200000;
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("Falta el cuerpo de la solicitud");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new DomainError("Lote demasiado grande (máximo 3,2 MB)");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DomainError("JSON no válido");
  }
}
export function requireSameOrigin(request: Request) {
  const expected = new URL(process.env.APP_URL ?? request.url).origin;
  if (request.headers.get("origin") !== expected)
    throw new DomainError("Origen de solicitud no autorizado");
}
export function errorResponse(error: unknown) {
  if (error instanceof AccessConfigurationError)
    return Response.json({ error: error.message }, { status: 503 });
  if (error instanceof DomainError)
    return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: "Datos inválidos",
        fields: error.issues.map((i) => i.path.join(".")),
      },
      { status: 400 },
    );
  // Avoid logging corporate payloads or SQL parameter values.
  console.error(
    "Operación fallida",
    error instanceof Error ? error.name : "UnknownError",
  );
  return Response.json(
    {
      error:
        "No se pudo completar la operación. Verifica la conexión y configuración; los cambios transaccionales se revirtieron.",
    },
    { status: 500 },
  );
}
export function streamText(
  producer: (enqueue: (text: string) => void) => Promise<void>,
  filename: string,
  type: string,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await producer((text) => controller.enqueue(encoder.encode(text)));
        controller.close();
      } catch {
        controller.error(
          new Error("La descarga se interrumpió; vuelve a intentarlo."),
        );
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
