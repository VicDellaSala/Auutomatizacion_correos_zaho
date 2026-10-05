import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { verifyPassword } from "./password";
const cookieName = "atencion_session";
function tokenHash(token: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("AUTH_SECRET debe tener al menos 32 caracteres");
  return createHmac("sha256", secret).update(token).digest("hex");
}
export async function currentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash(token)),
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
export async function login(email: string, password: string) {
  const user = await db().transaction(async (tx) => {
    const [u] = await tx
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .for("update");
    if (!u) {
      verifyPassword(
        password,
        `00000000000000000000000000000000:${"0".repeat(128)}`,
      );
      return null;
    }
    if (u.lockedUntil && u.lockedUntil > new Date()) return null;
    if (!verifyPassword(password, u.passwordHash)) {
      await tx
        .update(users)
        .set({
          failedAttempts: sql`${users.failedAttempts}+1`,
          lockedUntil:
            u.failedAttempts >= 4 ? new Date(Date.now() + 15 * 60000) : null,
        })
        .where(eq(users.id, u.id));
      return null;
    }
    await tx
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(users.id, u.id));
    return u;
  });
  if (!user) return false;
  const token = randomBytes(32).toString("hex"),
    expiresAt = new Date(Date.now() + 8 * 3600000);
  await db()
    .insert(sessions)
    .values({ tokenHash: tokenHash(token), userId: user.id, expiresAt });
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
      .where(eq(sessions.tokenHash, tokenHash(token)));
  jar.delete(cookieName);
}
