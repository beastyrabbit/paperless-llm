"use client";

import { RouteErrorState } from "@/components/route-state";

export default function SearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState title="Search could not be loaded" error={error} reset={reset} />;
}
