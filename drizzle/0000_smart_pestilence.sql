CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "agents_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"rootKey" text PRIMARY KEY NOT NULL,
	"firstResponseKey" text,
	"firstResponseAt" timestamp with time zone,
	"responseSeconds" bigint,
	"responseCount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_imports" (
	"importId" uuid NOT NULL,
	"emailKey" text NOT NULL,
	CONSTRAINT "email_imports_importId_emailKey_pk" PRIMARY KEY("importId","emailKey")
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"key" text PRIMARY KEY NOT NULL,
	"messageId" text,
	"date" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"staffName" text,
	"addressed" boolean NOT NULL,
	"decision" jsonb,
	"kind" text NOT NULL,
	"rootKey" text,
	"searchText" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_entries" (
	"importId" uuid NOT NULL,
	"sourceFile" text NOT NULL,
	"error" text,
	CONSTRAINT "import_entries_importId_sourceFile_pk" PRIMARY KEY("importId","sourceFile")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"size" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'PROCESSING' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdBy" text NOT NULL,
	"approvedBy" text,
	"approvedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "restore_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"completed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restore_rows" (
	"jobId" uuid NOT NULL,
	"line" integer NOT NULL,
	"table" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "restore_rows_jobId_line_pk" PRIMARY KEY("jobId","line")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"mailbox" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staged_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"importId" uuid NOT NULL,
	"key" text NOT NULL,
	"sourceFile" text NOT NULL,
	"data" jsonb NOT NULL,
	"staffName" text,
	"addressed" boolean NOT NULL,
	"decision" jsonb,
	"state" text DEFAULT 'PENDING' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"passwordHash" text NOT NULL,
	"failedAttempts" integer DEFAULT 0 NOT NULL,
	"lockedUntil" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_rootKey_emails_key_fk" FOREIGN KEY ("rootKey") REFERENCES "public"."emails"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_firstResponseKey_emails_key_fk" FOREIGN KEY ("firstResponseKey") REFERENCES "public"."emails"("key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_imports" ADD CONSTRAINT "email_imports_importId_imports_id_fk" FOREIGN KEY ("importId") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_imports" ADD CONSTRAINT "email_imports_emailKey_emails_key_fk" FOREIGN KEY ("emailKey") REFERENCES "public"."emails"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_entries" ADD CONSTRAINT "import_entries_importId_imports_id_fk" FOREIGN KEY ("importId") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_jobs" ADD CONSTRAINT "restore_jobs_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_rows" ADD CONSTRAINT "restore_rows_jobId_restore_jobs_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."restore_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_emails" ADD CONSTRAINT "staged_emails_importId_imports_id_fk" FOREIGN KEY ("importId") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emails_root_idx" ON "emails" USING btree ("rootKey");--> statement-breakpoint
CREATE INDEX "emails_date_idx" ON "emails" USING btree ("date");--> statement-breakpoint
CREATE INDEX "emails_message_idx" ON "emails" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "imports_fingerprint_idx" ON "imports" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "staged_import_idx" ON "staged_emails" USING btree ("importId");--> statement-breakpoint
CREATE UNIQUE INDEX "staged_import_key_unique" ON "staged_emails" USING btree ("importId","key");