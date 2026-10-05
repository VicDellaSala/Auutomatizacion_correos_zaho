import { requireUser } from "@/lib/auth/session";
import { ListPage } from "@/components/list-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireUser();
  const p = await searchParams;
  return (
    <ListPage
      title={
        p.view === "review" ? "Histórico por revisar" : "Todas las solicitudes"
      }
      view={p.view === "review" ? "review" : "all"}
      params={p}
    />
  );
}
