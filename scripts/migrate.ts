import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "../src/lib/db";
import { agents, settings } from "../src/lib/db/schema";
export const initialAgents = [
  { name: "Geraldine Serrano", email: "geraldine.serrano@credicard.com.ve" },
  { name: "Rubén Castro", email: "ruben.castro@credicard.com.ve" },
  { name: "Lyliana Tarazona", email: "lyliana.tarazona@credicard.com.ve" },
  { name: "Yessika Salcedo", email: "yessika.salcedo@credicard.com.ve" },
];
await migrate(db(), { migrationsFolder: "drizzle" });
await db()
  .insert(settings)
  .values({ id: 1, mailbox: "atencionagentes@credicard.com.ve" })
  .onConflictDoNothing();
await db().insert(agents).values(initialAgents).onConflictDoNothing();
console.log("Migraciones e inicialización completadas.");
process.exit(0);
