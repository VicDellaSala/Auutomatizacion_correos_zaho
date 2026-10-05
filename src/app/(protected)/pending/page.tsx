import { requireUser } from "@/lib/auth/session";
import { ImportHistory } from "@/components/import-history";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireUser();
  const p = await searchParams;
  return <ImportHistory pending page={Math.max(1, Number(p.page) || 1)} />;
}
