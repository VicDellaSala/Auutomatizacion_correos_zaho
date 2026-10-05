import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { agents, settings } from "@/lib/db/schema";
import { PageHeading } from "@/components/page-heading";
import { SettingsForm } from "@/components/settings-form";
import { BackupPanel } from "@/components/backup-panel";
export default async function Settings() {
  await requireUser();
  const [config] = await db().select().from(settings);
  const staff = await db().select().from(agents).orderBy(agents.name);
  return (
    <>
      <PageHeading
        title="Configuración"
        description="Administra el buzón, el equipo y los respaldos."
      />
      <SettingsForm
        key={JSON.stringify(staff) + config.mailbox}
        mailbox={config.mailbox}
        agents={staff}
      />
      <BackupPanel />
    </>
  );
}
