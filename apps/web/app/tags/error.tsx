"use client";

import { RouteErrorState } from "@/components/route-state";

export default function TagsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState title="Workflow tags could not be loaded" error={error} reset={reset} />;
}
