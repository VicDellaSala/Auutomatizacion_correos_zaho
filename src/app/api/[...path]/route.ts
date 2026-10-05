import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { currentUser, login, logout } from "@/lib/auth/session";
import {
  approve,
  decide,
  discard,
  DomainError,
  getImport,
  ingestBatch,
  lock,
  reject,
  revert,
} from "@/lib/imports/service";
import { emailSchema, decisionSchema } from "@/lib/validation/email";
import {
  errorResponse,
  readJson,
  requireSameOrigin,
  streamText,
} from "@/lib/http";
import { reportHtml } from "@/lib/reports/html";
import {
  backupLines,
  stageRestore,
  finishRestore,
  commitRestore,
  checkJob,
} from "@/lib/backup/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, ctx: Context) {
  try {
    const { path } = await ctx.params;
    const method = request.method;
    if (method !== "GET") requireSameOrigin(request);
    if (path.join("/") === "auth/login" && method === "POST") {
      const body = z
        .object({
          email: z.email().max(320),
          password: z.string().min(1).max(1024),
        })
        .parse(await readJson(request));
      return (await login(body.email, body.password))
        ? Response.json({ ok: true })
        : Response.json(
            {
              error:
                "Credenciales inválidas o acceso bloqueado temporalmente. Intenta de nuevo en 15 minutos si hubo varios intentos.",
            },
            { status: 401 },
          );
    }
    const user = await currentUser();
    if (!user)
      return Response.json(
        { error: "Inicia sesión para continuar" },
        { status: 401 },
      );
    if (path.join("/") === "auth/logout" && method === "POST") {
      await logout();
      return Response.json({ ok: true });
    }
    if (path[0] === "lookup" && method === "GET") {
      const query = new URL(request.url).searchParams;
      const term = `%${(query.get("q") ?? "").slice(0, 200).replace(/[\\%_]/g, "\\$&")}%`;
      const importId = z.uuid().parse(query.get("importId"));
      const rows = await db().execute(
        sql`select key,data->>'subject' as subject,data->>'date' as date,data->'from'->>'address' as "from" from emails where kind in ('REQUEST','STAFF_SENT') and "searchText" ilike ${term} union select key,data->>'subject' as subject,data->>'date' as date,data->'from'->>'address' as "from" from staged_emails where "importId"=${importId} and state='PENDING' and (data->>'subject' ilike ${term} or data->'from'->>'address' ilike ${term}) limit 40`,
      );
      return Response.json({ rows: rows.rows });
    }
    if (path[0] === "reports" && method === "GET") {
      const params = new URL(request.url).searchParams;
      const filters = {
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
        q: params.get("q") ?? undefined,
        person: params.get("person") ?? undefined,
      };
      return streamText(
        async (enqueue) => {
          await db().transaction(
            async (tx) => {
              for await (const line of reportHtml(tx, filters)) enqueue(line);
            },
            { isolationLevel: "repeatable read", accessMode: "read only" },
          );
        },
        "reporte-atencion.html",
        "text/html; charset=utf-8",
      );
    }
    if (path[0] === "backup" && method === "GET")
      return streamText(
        async (enqueue) => {
          await db().transaction(
            async (tx) => {
              for await (const line of backupLines(tx)) enqueue(line);
            },
            { isolationLevel: "repeatable read", accessMode: "read only" },
          );
        },
        "respaldo-atencion.jsonl",
        "application/x-ndjson; charset=utf-8",
      );
    if (path[0] === "restore") {
      if (method === "POST" && path.length === 1) {
        const [job] = await db()
          .insert(s.restoreJobs)
          .values({ userId: user.id })
          .returning();
        return Response.json({ id: job.id });
      }
      const id = z.uuid().parse(path[1]);
      if (method === "DELETE") {
        await checkJob(db(), id, user.id);
        await db().delete(s.restoreJobs).where(eq(s.restoreJobs.id, id));
        return Response.json({ ok: true });
      }
      const body = await readJson(request);
      if (path[2] === "batch") {
        const data = z
          .object({
            rows: z
              .array(
                z.object({
                  line: z.number().int().nonnegative(),
                  table: z.enum([
                    "agents",
                    "settings",
                    "imports",
                    "emails",
                    "emailImports",
                    "stagedEmails",
                    "importEntries",
                  ]),
                  data: z.unknown(),
                }),
              )
              .min(1)
              .max(100),
          })
          .parse(body);
        await stageRestore(db(), id, user.id, data.rows);
      } else if (path[2] === "finish") {
        const counts = z
          .record(z.string(), z.number().int().nonnegative())
          .parse(body.counts);
        return Response.json({
          counts: await finishRestore(db(), id, user.id, counts),
        });
      } else if (path[2] === "commit") {
        if (body.confirm !== "RESTAURAR")
          throw new DomainError("Confirmación requerida");
        await commitRestore(db(), id, user.id);
      } else throw new DomainError("Acción desconocida");
      return Response.json({ ok: true });
    }
    if (path[0] === "settings" && method === "POST") {
      const body = z
        .object({
          mailbox: z.email(),
          agents: z
            .array(
              z.object({
                id: z.uuid().optional(),
                name: z.string().trim().min(1).max(200),
                email: z.email(),
                active: z.boolean(),
              }),
            )
            .min(1)
            .max(100),
        })
        .parse(await readJson(request));
      if (
        new Set(body.agents.map((a) => a.email.toLowerCase())).size !==
        body.agents.length
      )
        throw new DomainError("Hay correos de miembros repetidos");
      await db().transaction(async (tx) => {
        await lock(tx);
        await tx
          .update(s.settings)
          .set({ mailbox: body.mailbox.toLowerCase() })
          .where(eq(s.settings.id, 1));
        for (const a of body.agents) {
          if (a.id)
            await tx
              .update(s.agents)
              .set({
                name: a.name,
                email: a.email.toLowerCase(),
                active: a.active,
              })
              .where(eq(s.agents.id, a.id));
          else
            await tx
              .insert(s.agents)
              .values({ ...a, email: a.email.toLowerCase() });
        }
      });
      return Response.json({ ok: true });
    }
    if (path[0] === "imports") {
      if (path.length === 1 && method === "POST") {
        const body = z
          .object({
            filename: z.string().min(1).max(2000),
            size: z.number().int().nonnegative(),
            fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
            total: z.number().int().min(1).max(100000),
            resumeId: z.uuid().optional(),
          })
          .parse(await readJson(request));
        const row = await db().transaction(async (tx) => {
          await lock(tx);
          if (body.resumeId) {
            const imp = await getImport(tx, body.resumeId);
            if (imp.fingerprint !== body.fingerprint)
              throw new DomainError(
                "El archivo no corresponde a esta importación",
              );
            if (["DISCARDED", "APPROVED", "REVERTED"].includes(imp.status))
              throw new DomainError("Importación cerrada; crea una nueva");
            await tx
              .update(s.imports)
              .set({ status: "PROCESSING", updatedAt: new Date() })
              .where(eq(s.imports.id, imp.id));
            return imp;
          }
          const [created] = await tx
            .insert(s.imports)
            .values({
              filename: body.filename,
              size: body.size,
              fingerprint: body.fingerprint,
              total: body.total,
              createdBy: user.email,
            })
            .returning();
          return created;
        });
        const entries = await db()
          .select()
          .from(s.importEntries)
          .where(eq(s.importEntries.importId, row.id));
        return Response.json({
          id: row.id,
          processedFiles: entries
            .filter((e) => !e.error)
            .map((e) => e.sourceFile),
          errors: 0,
        });
      }
      const id = z.uuid().parse(path[1]);
      if (path[2] === "errors" && method === "GET") {
        await getImport(db(), id);
        const errors = await db()
          .select({
            archivo: s.importEntries.sourceFile,
            error: s.importEntries.error,
          })
          .from(s.importEntries)
          .where(
            and(
              eq(s.importEntries.importId, id),
              sql`${s.importEntries.error} is not null`,
            ),
          );
        return new Response(JSON.stringify(errors, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition":
              "attachment; filename=errores-importacion.json",
            "Cache-Control": "no-store",
          },
        });
      }
      if (path[2] === "staging-batch" && method === "POST") {
        const body = z
          .object({
            total: z.number().int().min(1).max(100000),
            entries: z
              .array(
                z
                  .object({
                    sourceFile: z.string().min(1).max(2000),
                    data: emailSchema.optional(),
                    error: z.string().max(4000).optional(),
                  })
                  .refine((e) => Boolean(e.data) !== Boolean(e.error)),
              )
              .min(1)
              .max(100),
          })
          .parse(await readJson(request));
        await ingestBatch(db(), id, body.entries, body.total);
        return Response.json({ ok: true });
      }
      if (method === "PATCH") {
        const body = await readJson(request);
        const ids = () => z.array(z.uuid()).min(1).max(10000).parse(body.ids);
        switch (body.action) {
          case "approve":
            return Response.json({
              approved: await approve(
                db(),
                id,
                body.all === true ? "all" : ids(),
                user.email,
              ),
            });
          case "reject":
            await reject(db(), id, ids());
            break;
          case "decide":
            await decide(
              db(),
              id,
              z.uuid().parse(body.rowId),
              decisionSchema.parse(body.decision),
            );
            break;
          case "discard":
            await discard(db(), id);
            break;
          case "revert":
            if (body.confirm !== "REVERTIR")
              throw new DomainError("Confirmación requerida");
            await revert(db(), id);
            break;
          case "pause":
          case "finish":
            await db().transaction(async (tx) => {
              await lock(tx);
              const imp = await getImport(tx, id);
              if (["DISCARDED", "APPROVED", "REVERTED"].includes(imp.status))
                throw new DomainError("Importación cerrada");
              if (body.action === "finish") {
                const n = await tx
                  .select({ count: sql<number>`count(*)::int` })
                  .from(s.importEntries)
                  .where(eq(s.importEntries.importId, id));
                if (n[0].count < imp.total)
                  throw new DomainError(
                    "Quedan archivos sin procesar; reanuda la importación",
                  );
              }
              const prior = await tx
                .select({ id: s.stagedEmails.id })
                .from(s.stagedEmails)
                .where(
                  and(
                    eq(s.stagedEmails.importId, id),
                    eq(s.stagedEmails.state, "APPROVED"),
                  ),
                )
                .limit(1);
              await tx
                .update(s.imports)
                .set({
                  status:
                    body.action === "pause"
                      ? "PARTIAL"
                      : prior.length
                        ? "PARTIALLY_APPROVED"
                        : "READY_FOR_REVIEW",
                  updatedAt: new Date(),
                })
                .where(eq(s.imports.id, id));
            });
            break;
          default:
            throw new DomainError("Acción desconocida");
        }
        return Response.json({ ok: true });
      }
    }
    return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}
export const GET = handle,
  POST = handle,
  PATCH = handle,
  DELETE = handle;
