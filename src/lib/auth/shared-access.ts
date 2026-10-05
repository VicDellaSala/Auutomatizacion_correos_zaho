import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { users } from "@/lib/db/schema";

export class AccessConfigurationError extends Error {}
export const sharedAccountEmail = "shared-access@internal.invalid";

export function accessConfiguration(env: Record<string, string | undefined> = process.env) {
  const password = env.APP_PASSWORD;
  const secret = env.AUTH_SECRET;
  if (!password || password === "replace-with-your-private-access-password") {
    throw new AccessConfigurationError(
      "Falta configurar APP_PASSWORD en las variables de entorno de Vercel. Guarda la clave de acceso y vuelve a desplegar.",
    );
  }
  if (!secret || secret.length < 32 || secret.startsWith("replace-with-")) {
    throw new AccessConfigurationError(
      "Falta configurar AUTH_SECRET: usa un valor aleatorio de al menos 32 caracteres en Vercel y vuelve a desplegar.",
    );
  }
  return { password, secret };
}

export function matchesAccessPassword(actual: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export function sessionTokenHash(
  token: string,
  config = accessConfiguration(),
) {
  // Rotating either environment secret invalidates all prior sessions.
  return createHmac("sha256", config.secret)
    .update(createHash("sha256").update(config.password).digest())
    .update(token)
    .digest("hex");
}

export async function authenticateSharedAccess(
  database: Database,
  password: string,
  expectedPassword: string,
  now = new Date(),
) {
  return database.transaction(async (tx) => {
    // Technical identity for sessions/audit/FKs; no user registration or creation command.
    await tx
      .insert(users)
      .values({
        email: sharedAccountEmail,
        name: "Acceso compartido",
        passwordHash: "!environment-managed-shared-access",
      })
      .onConflictDoNothing();
    const [account] = await tx
      .select()
      .from(users)
      .where(eq(users.email, sharedAccountEmail))
      .for("update");
    if (account.lockedUntil && account.lockedUntil > now) return null;
    const attempts = account.lockedUntil ? 0 : account.failedAttempts;
    if (!matchesAccessPassword(password, expectedPassword)) {
      await tx
        .update(users)
        .set({
          failedAttempts: attempts + 1,
          lockedUntil:
            attempts >= 4 ? new Date(now.getTime() + 15 * 60000) : null,
        })
        .where(eq(users.id, account.id));
      return null;
    }
    await tx
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(users.id, account.id));
    return account;
  });
}

export function storageAccessError(error: unknown): AccessConfigurationError {
  let cause = error;
  for (
    let depth = 0;
    cause && typeof cause === "object" && depth < 5;
    depth++
  ) {
    if ("code" in cause && cause.code === "42P01") {
      return new AccessConfigurationError(
        "La base de datos todavía no está inicializada. Ejecuta npm run db:migrate con DATABASE_URL configurada. No necesitas crear un usuario.",
      );
    }
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return new AccessConfigurationError(
    "No se pudo abrir la sesión en PostgreSQL. Comprueba DATABASE_URL y que la base esté disponible. No necesitas crear un usuario.",
  );
}
