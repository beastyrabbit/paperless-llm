import { redirect } from "next/navigation";

export default function PendingRedirect() {
  redirect("/cases?status=needs_input");
}
