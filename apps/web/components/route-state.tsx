"use client";

import { Button } from "@repo/ui";

interface RouteErrorStateProps {
  title: string;
  error: Error & { digest?: string };
  reset: () => void;
}

interface RouteLoadingStateProps {
  message: string;
}

export function RouteErrorState({ title, error, reset }: RouteErrorStateProps) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-3xl flex-col justify-center gap-4 px-6">
      <div role="alert" className="space-y-2">
        <h1 className="font-semibold text-2xl">{title}</h1>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
      <Button type="button" className="w-fit" onClick={reset}>
        Retry
      </Button>
    </main>
  );
}

export function RouteLoadingState({ message }: RouteLoadingStateProps) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-3xl items-center px-6">
      <div role="status" aria-live="polite" className="text-muted-foreground text-sm">
        {message}
      </div>
    </main>
  );
}
