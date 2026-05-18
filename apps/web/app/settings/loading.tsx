export default function SettingsLoading() {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-3xl items-center px-6">
      <div role="status" aria-live="polite" className="text-muted-foreground text-sm">
        Loading settings...
      </div>
    </main>
  );
}
