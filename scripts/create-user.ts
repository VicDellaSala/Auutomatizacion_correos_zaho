import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { db } from "../src/lib/db";
import { users } from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/auth/password";
const input = createInterface({ input: process.stdin, output: process.stdout });
const email = await input.question("Correo de acceso: ");
const name = await input.question("Nombre: ");
// Prefer a one-time environment variable on non-interactive hosts; never write the password to a file.
const password =
  process.env.ADMIN_PASSWORD ??
  (await input.question(
    "Contraseña (mínimo 12 caracteres, entrada visible en terminal): ",
  ));
input.close();
if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || !name.trim())
  throw new Error("Datos inválidos");
await db()
  .insert(users)
  .values({
    email: email.trim().toLowerCase(),
    name: name.trim(),
    passwordHash: hashPassword(password),
  });
console.log("Usuario creado.");
process.exit(0);
