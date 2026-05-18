import { redirect } from "next/navigation";

export default async function LegacyProcessRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/documents/${id}/log`);
}
