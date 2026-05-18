"use client";

import { RouteErrorState } from "@/components/route-state";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState title="Chat could not be loaded" error={error} reset={reset} />;
}
