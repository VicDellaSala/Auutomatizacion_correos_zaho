import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
export type Database = NodePgDatabase<typeof schema>;
let connection: Database | undefined;
export function db(): Database {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Falta DATABASE_URL. Configura PostgreSQL y ejecuta las migraciones.",
    );
  return (connection ??= drizzle(
    new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    }),
    { schema },
  ));
}
