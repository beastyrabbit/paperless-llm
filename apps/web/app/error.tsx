"use client";

import { RouteErrorState } from "@/components/route-state";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState title="Dashboard could not be loaded" error={error} reset={reset} />;
}
