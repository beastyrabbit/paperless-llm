"use client";

import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import { Activity, FlaskConical, RefreshCw, ServerCog } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ConnectionsTab, RuntimeTab } from "./components";

type SettingsTab = "connections" | "runtime";

function SettingsPageContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "runtime" ? "runtime" : "connections";
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5 md:px-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
              Runtime configuration is injected by Infisical at startup. This page is deliberately
              read-only so the UI and backend cannot use different provider credentials or URLs.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRefreshToken((value) => value + 1)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button asChild>
              <Link href="/system-test">
                <FlaskConical className="mr-2 h-4 w-4" />
                Open system test
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 md:px-8">
        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
          <TabsList className="mb-6">
            <TabsTrigger value="connections">
              <Activity className="mr-2 h-4 w-4" />
              Connections
            </TabsTrigger>
            <TabsTrigger value="runtime">
              <ServerCog className="mr-2 h-4 w-4" />
              Paperless-first runtime
            </TabsTrigger>
          </TabsList>
          <TabsContent value="connections">
            <ConnectionsTab refreshToken={refreshToken} />
          </TabsContent>
          <TabsContent value="runtime">
            <RuntimeTab refreshToken={refreshToken} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
          <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
        </div>
      }
    >
      <SettingsPageContent />
    </Suspense>
  );
}
