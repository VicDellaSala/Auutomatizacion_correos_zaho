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
      title="Correos enviados por personal"
      view="staff-sent"
      params={await searchParams}
    />
  );
}
