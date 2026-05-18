"use client";

import { RouteErrorState } from "@/components/route-state";

export default function PendingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState title="Pending review could not be loaded" error={error} reset={reset} />;
}
