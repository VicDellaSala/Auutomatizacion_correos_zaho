import { requireUser } from "@/lib/auth/session";
import { ListPage } from "@/components/list-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireUser();
  return (
    <ListPage
      title="Pendientes (fuera del horario)"
      view="after-hours"
      params={await searchParams}
    />
  );
}
