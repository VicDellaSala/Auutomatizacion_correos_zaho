import { requireUser } from "@/lib/auth/session";
import { PageHeading } from "@/components/page-heading";
import { ImportUploader } from "@/components/import-uploader";
export default async function Import({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  await requireUser();
  const { resume } = await searchParams;
  return (
    <>
      <PageHeading
        title="Importar correos"
        description="Incorpora nuevas exportaciones a tu histórico, con revisión previa."
      />
      <ImportUploader resumeId={resume} />
    </>
  );
}
