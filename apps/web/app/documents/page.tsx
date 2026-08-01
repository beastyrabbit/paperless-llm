"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
} from "@repo/ui";
import type { DocumentSummary } from "@repo/api-contracts";
import { ArrowRight, CircleAlert, FileText, Loader2, Play, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { documentsApi } from "@/lib/api";

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<readonly DocumentSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await documentsApi.list(100);
    if (response.ok) setDocuments(response.data);
    else setError(response.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return documents;
    return documents.filter(
      (document) =>
        String(document.id) === normalized ||
        document.title.toLowerCase().includes(normalized) ||
        document.correspondent?.toLowerCase().includes(normalized) ||
        document.tags.some((tag) => tag.toLowerCase().includes(normalized)),
    );
  }, [documents, query]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5 md:px-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Current values read directly from Paperless. The application does not persist this list.
            </p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      <main className="space-y-4 px-6 py-6 md:px-8">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the loaded documents by ID, title, correspondent, or tag"
            className="pl-9"
          />
        </div>

        {error ? (
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Paperless documents unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading current Paperless documents…
              </div>
            ) : filtered.length ? (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filtered.map((document) => (
                  <article
                    key={document.id}
                    className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/documents/${document.id}`}
                        className="flex items-center gap-2 font-medium hover:underline"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="truncate">{document.title || `Document #${document.id}`}</span>
                      </Link>
                      <p className="mt-1 text-xs text-zinc-500">
                        #{document.id}
                        {document.correspondent ? ` · ${document.correspondent}` : ""}
                        {document.created ? ` · ${new Date(document.created).toLocaleDateString()}` : ""}
                      </p>
                      {document.tags.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {document.tags.slice(0, 6).map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/documents/${document.id}`}>
                          Details
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild size="sm">
                        <Link href={`/workbench?documentId=${document.id}`}>
                          <Play className="mr-2 h-4 w-4" />
                          Analyze
                        </Link>
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="p-8 text-center text-sm text-zinc-500">
                No documents match the current search.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
