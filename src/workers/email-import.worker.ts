/// <reference lib="webworker" />
import {
  BlobReader,
  ZipReader,
  Uint8ArrayWriter,
  configure,
} from "@zip.js/zip.js";
import { parseEmail } from "@/lib/email/mime-parser";
import { sha256 } from "@/lib/email/normalize";
import { emailSchema } from "@/lib/validation/email";
import type { EmailData } from "@/types/email";
configure({ useWebWorkers: false });
const MAX_ENTRY = 64 * 1024 * 1024,
  BATCH_BYTES = 750000,
  MAX_MESSAGE_JSON = 2800000;
type EntryResult = { sourceFile: string; data?: EmailData; error?: string };
async function api(path: string, body: unknown, method = "POST") {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500)
          throw new Error(data.error ?? "Solicitud rechazada");
        if (attempt === 2)
          throw new Error(data.error ?? "Servidor no disponible");
      } else return data;
    } catch (error) {
      if (
        attempt === 2 ||
        (error instanceof Error && error.message !== "Failed to fetch")
      )
        throw error;
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error("No se pudo guardar el lote");
}
self.onmessage = async (
  event: MessageEvent<{ file: File; resumeId?: string }>,
) => {
  let id: string | undefined;
  let reader: ZipReader<Blob> | undefined;
  try {
    const { file, resumeId } = event.data;
    reader = new ZipReader(new BlobReader(file));
    const signatures: string[] = [];
    let total = 0;
    self.postMessage({
      type: "progress",
      stage: "Leyendo índice del ZIP",
      total: 0,
      processed: 0,
    });
    for await (const entry of reader.getEntriesGenerator()) {
      if (!entry.directory && /\.eml$/i.test(entry.filename)) {
        total++;
        signatures.push(
          `${entry.filename}:${entry.uncompressedSize}:${entry.signature}`,
        );
      }
      if (total > 100000)
        throw new Error("Máximo 100.000 EML por ZIP; divide esta exportación.");
    }
    if (!total) throw new Error("El ZIP no contiene archivos EML.");
    const fingerprint = await sha256(`${file.size}\n${signatures.join("\n")}`);
    signatures.length = 0;
    const created = await api("/api/imports", {
      filename: file.name,
      size: file.size,
      fingerprint,
      total,
      resumeId,
    });
    id = created.id;
    self.postMessage({ type: "created", id, total });
    const done = new Set<string>(created.processedFiles);
    let processed = done.size,
      errors = created.errors ?? 0;
    let batch: EntryResult[] = [],
      bytes = 0,
      index = 0;
    const flush = async () => {
      if (batch.length) {
        await api(`/api/imports/${id}/staging-batch`, {
          entries: batch,
          total,
        });
        batch = [];
        bytes = 0;
      }
    };
    for await (const entry of reader.getEntriesGenerator()) {
      if (entry.directory || !/\.eml$/i.test(entry.filename)) continue;
      const sourceFile = `${index++}:${entry.filename}`;
      if (done.has(sourceFile)) continue;
      self.postMessage({
        type: "progress",
        id,
        total,
        processed,
        errors,
        current: entry.filename,
        stage: "Procesando EML",
      });
      let result: EntryResult;
      try {
        if (entry.uncompressedSize > MAX_ENTRY)
          throw new Error(
            "EML mayor de 64 MiB; sepáralo o reduce sus adjuntos antes de reimportar.",
          );
        const raw = await entry.getData(new Uint8ArrayWriter(), {
          checkSignature: true,
          onprogress: (size) => {
            if (size > MAX_ENTRY)
              throw new Error(
                "EML supera el límite de descompresión de 64 MiB",
              );
          },
        });
        const data = emailSchema.parse(await parseEmail(raw));
        result = { sourceFile, data };
        if (
          new TextEncoder().encode(JSON.stringify(result)).byteLength >
          MAX_MESSAGE_JSON
        )
          throw new Error(
            "Contenido de texto demasiado grande para un lote seguro; correo no guardado, sin truncamiento.",
          );
      } catch (error) {
        errors++;
        result = {
          sourceFile,
          error: error instanceof Error ? error.message : "EML no válido",
        };
      }
      const length = new TextEncoder().encode(
        JSON.stringify(result),
      ).byteLength;
      if (bytes + length > BATCH_BYTES) await flush();
      batch.push(result);
      bytes += length;
      processed++;
      if (batch.length >= 100 || bytes >= BATCH_BYTES) await flush();
      self.postMessage({
        type: "progress",
        id,
        total,
        processed,
        errors,
        current: entry.filename,
        stage: "Procesando EML",
      });
    }
    await flush();
    await api(`/api/imports/${id}`, { action: "finish" }, "PATCH");
    self.postMessage({ type: "done", id, total, processed, errors });
  } catch (error) {
    if (id) {
      try {
        await api(`/api/imports/${id}`, { action: "pause" }, "PATCH");
      } catch {}
    }
    self.postMessage({
      type: "error",
      id,
      message:
        error instanceof Error ? error.message : "No se pudo procesar el ZIP",
    });
  } finally {
    await reader?.close();
  }
};
