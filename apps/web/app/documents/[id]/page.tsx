"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import type { DocumentDetail, Settings } from "@repo/api-contracts";
import {
  ArrowLeft,
  CircleAlert,
  ExternalLink,
  FileText,
  Loader2,
  Play,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { documentsApi, settingsApi } from "@/lib/api";

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const documentId = Number(params.id);
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(documentId) || documentId <= 0) {
      setError("Invalid Paperless document ID.");
      setLoading(false);
      return;
    }
    let active = true;
    void Promise.all([documentsApi.get(documentId), settingsApi.get()]).then(
      ([documentResponse, settingsResponse]) => {
        if (!active) return;
        if (documentResponse.ok) setDocument(documentResponse.data);
        else setError(documentResponse.error);
        if (settingsResponse.ok) setSettings(settingsResponse.data);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [documentId]);

  const paperlessUrl = useMemo(() => {
    const base = settings?.paperless_external_url || settings?.paperless_url;
    return base ? `${base.replace(/\/$/, "")}/documents/${documentId}/details` : null;
  }, [documentId, settings]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 dark:bg-zinc-950 md:p-8">
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Document unavailable</AlertTitle>
          <AlertDescription>{error ?? "Paperless did not return the document."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5 md:px-8">
          <div className="min-w-0">
            <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
              <Link href="/documents">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Documents
              </Link>
            </Button>
            <h1 className="truncate text-2xl font-semibold tracking-tight">{document.title}</h1>
            <p className="mt-1 text-sm text-zinc-500">Paperless document #{document.id}</p>
          </div>
          <div className="flex gap-2">
            {paperlessUrl ? (
              <Button asChild variant="outline">
                <a href={paperlessUrl} target="_blank" rel="noreferrer">
                  Open in Paperless
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            ) : null}
            <Button asChild>
              <Link href={`/workbench?documentId=${document.id}`}>
                <Play className="mr-2 h-4 w-4" />
                Analyze
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="grid gap-6 px-6 py-6 md:px-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-lg">Document</CardTitle>
            <CardDescription>
              The PDF and OCR content are streamed from Paperless and are not persisted in the UI.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="pdf">
              <TabsList>
                <TabsTrigger value="pdf">PDF</TabsTrigger>
                <TabsTrigger value="content">Paperless content</TabsTrigger>
              </TabsList>
              <TabsContent value="pdf" className="mt-4">
                <iframe
                  title={`PDF preview for ${document.title}`}
                  src={documentsApi.getPdfUrl(document.id)}
                  className="h-[70vh] w-full rounded-md border border-zinc-200 bg-white dark:border-zinc-800"
                />
              </TabsContent>
              <TabsContent value="content" className="mt-4">
                <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-100 p-4 text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
                  {document.content || "Paperless has no extracted content for this document."}
                </pre>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-zinc-500" />
                Current metadata
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <MetadataRow label="Correspondent" value={document.correspondent || "—"} />
              <MetadataRow label="Document type" value={document.document_type || "—"} />
              <MetadataRow label="Created" value={new Date(document.created).toLocaleString()} />
              <MetadataRow label="Modified" value={new Date(document.modified).toLocaleString()} />
              <MetadataRow label="Original file" value={document.original_file_name || "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tags</CardTitle>
            </CardHeader>
            <CardContent>
              {document.tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {document.tags.map((tag) => (
                    <Badge key={tag.id} variant="secondary">
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No tags.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-zinc-200 pb-2 last:border-0 last:pb-0 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 break-words">{value}</p>
    </div>
  );
}
