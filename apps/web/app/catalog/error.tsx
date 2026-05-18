"use client";

import { Button } from "@repo/ui";

export default function CatalogError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-3xl flex-col justify-center gap-4 px-6">
      <div role="alert" className="space-y-2">
        <h1 className="font-semibold text-2xl">Catalog could not be loaded</h1>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
      <Button type="button" className="w-fit" onClick={reset}>
        Retry
      </Button>
    </main>
  );
}
