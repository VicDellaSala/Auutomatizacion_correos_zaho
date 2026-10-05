import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import {
  AccessConfigurationError,
  accessConfiguration,
  authenticateSharedAccess,
  sessionTokenHash,
  sharedAccountEmail,
  storageAccessError,
} from "./shared-access";
const cookieName = "atencion_session";
export async function currentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sessionTokenHash(token)),
        eq(users.email, sharedAccountEmail),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
export async function login(password: string) {
  const config = accessConfiguration();
  if (
    !process.env.DATABASE_URL ||
    process.env.DATABASE_URL.includes("@host/database")
  )
    throw new AccessConfigurationError(
      "Falta configurar DATABASE_URL en Vercel. El histórico y las sesiones necesitan PostgreSQL. No necesitas crear un usuario.",
    );
  let user;
  try {
    user = await authenticateSharedAccess(db(), password, config.password);
  } catch (error) {
    throw storageAccessError(error);
  }
  if (!user) return false;
  const token = randomBytes(32).toString("hex"),
    expiresAt = new Date(Date.now() + 8 * 3600000);
  try {
    await db()
      .insert(sessions)
      .values({
        tokenHash: sessionTokenHash(token, config),
        userId: user.id,
        expiresAt,
      });
  } catch (error) {
    throw storageAccessError(error);
  }
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return true;
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token)
    await db()
      .delete(sessions)
      .where(eq(sessions.tokenHash, sessionTokenHash(token)));
  jar.delete(cookieName);
}
