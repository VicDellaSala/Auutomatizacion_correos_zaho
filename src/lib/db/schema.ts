import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  bigint,
  integer,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { EmailData, Decision, ImportStatus, Kind } from "@/types/email";
export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text().notNull(),
  failedAttempts: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true }),
});
export const sessions = pgTable("sessions", {
  tokenHash: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
});
export const agents = pgTable("agents", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text().notNull().unique(),
  active: boolean().notNull().default(true),
});
export const settings = pgTable("settings", {
  id: integer().primaryKey(),
  mailbox: text().notNull(),
});
export const imports = pgTable(
  "imports",
  {
    id: uuid().primaryKey().defaultRandom(),
    filename: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    fingerprint: text().notNull(),
    status: text().$type<ImportStatus>().notNull().default("PROCESSING"),
    total: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: text().notNull(),
    approvedBy: text(),
    approvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("imports_fingerprint_idx").on(t.fingerprint)],
);
export const stagedEmails = pgTable(
  "staged_emails",
  {
    id: uuid().primaryKey().defaultRandom(),
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    key: text().notNull(),
    sourceFile: text().notNull(),
    data: jsonb().$type<EmailData>().notNull(),
    staffName: text(),
    addressed: boolean().notNull(),
    decision: jsonb().$type<Decision>(),
    state: text()
      .$type<"PENDING" | "APPROVED" | "REJECTED">()
      .notNull()
      .default("PENDING"),
  },
  (t) => [
    index("staged_import_idx").on(t.importId),
    uniqueIndex("staged_import_key_unique").on(t.importId, t.key),
  ],
);
export const importEntries = pgTable(
  "import_entries",
  {
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    sourceFile: text().notNull(),
    error: text(),
  },
  (t) => [primaryKey({ columns: [t.importId, t.sourceFile] })],
);
export const emails = pgTable(
  "emails",
  {
    key: text().primaryKey(),
    messageId: text(),
    date: timestamp({ withTimezone: true }).notNull(),
    data: jsonb().$type<EmailData>().notNull(),
    staffName: text(),
    addressed: boolean().notNull(),
    decision: jsonb().$type<Decision>(),
    kind: text().$type<Kind>().notNull(),
    rootKey: text(),
    searchText: text().notNull(),
  },
  (t) => [
    index("emails_root_idx").on(t.rootKey),
    index("emails_date_idx").on(t.date),
    index("emails_message_idx").on(t.messageId),
  ],
);
export const emailImports = pgTable(
  "email_imports",
  {
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    emailKey: text()
      .notNull()
      .references(() => emails.key, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.importId, t.emailKey] })],
);
export const conversations = pgTable("conversations", {
  rootKey: text()
    .primaryKey()
    .references(() => emails.key, { onDelete: "cascade" }),
  firstResponseKey: text().references(() => emails.key, {
    onDelete: "set null",
  }),
  firstResponseAt: timestamp({ withTimezone: true }),
  responseSeconds: bigint({ mode: "number" }),
  responseCount: integer().notNull().default(0),
});
export const restoreJobs = pgTable("restore_jobs", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  ready: boolean().notNull().default(false),
  completed: boolean().notNull().default(false),
});
export const restoreRows = pgTable(
  "restore_rows",
  {
    jobId: uuid()
      .notNull()
      .references(() => restoreJobs.id, { onDelete: "cascade" }),
    line: integer().notNull(),
    table: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.line] })],
);
