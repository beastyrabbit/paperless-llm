"use client";

import { useEffect, useState } from "react";
import {
  Tag,
  Check,
  X,
  RefreshCw,
  Plus,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui";

interface TagStatus {
  key: string;
  name: string;
  exists: boolean;
  tag_id: number | null;
}

interface TagsStatusResponse {
  tags: TagStatus[];
  all_exist: boolean;
  missing_count: number;
}

const TAG_DESCRIPTIONS: Record<string, string> = {
  pending: "Documents waiting to be processed by the LLM pipeline",
  ocr_done: "OCR extraction has been completed",
  correspondent_done: "Correspondent has been identified and assigned",
  document_type_done: "Document type has been classified",
  title_done: "Document title has been assigned",
  tags_done: "Content tags have been assigned",
  processed: "Document has been fully processed by all pipeline stages",
};

const TAG_LABELS: Record<string, string> = {
  pending: "Pending",
  ocr_done: "OCR Done",
  correspondent_done: "Correspondent Done",
  document_type_done: "Document Type Done",
  title_done: "Title Done",
  tags_done: "Tags Done",
  processed: "Processed",
};

export default function TagsPage() {
  const [tagsStatus, setTagsStatus] = useState<TagsStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchTagsStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/tags/status");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setTagsStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tags status");
    } finally {
      setLoading(false);
    }
  };

  const createMissingTags = async () => {
    if (!tagsStatus) return;

    const missingTags = tagsStatus.tags
      .filter((t) => !t.exists)
      .map((t) => t.name);

    if (missingTags.length === 0) return;

    setCreating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/settings/tags/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_names: missingTags }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.created.length > 0) {
        setSuccessMessage(`Created ${result.created.length} tag(s): ${result.created.join(", ")}`);
      }

      if (result.failed.length > 0) {
        setError(`Failed to create: ${result.failed.join(", ")}`);
      }

      // Refresh status
      await fetchTagsStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tags");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    fetchTagsStatus();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Workflow Tags</h1>
            <p className="text-sm text-zinc-500">
              Manage tags used to track document processing status
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchTagsStatus}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {tagsStatus && tagsStatus.missing_count > 0 && (
              <Button
                size="sm"
                onClick={createMissingTags}
                disabled={creating}
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Create Missing Tags ({tagsStatus.missing_count})
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="p-8 max-w-4xl mx-auto space-y-6">
        {/* Status Summary */}
        {tagsStatus && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {tagsStatus.all_exist ? (
                    <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                      <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                  )}
                  <div>
                    <CardTitle className="text-lg">
                      {tagsStatus.all_exist
                        ? "All Workflow Tags Exist"
                        : `${tagsStatus.missing_count} Missing Tag${tagsStatus.missing_count > 1 ? "s" : ""}`}
                    </CardTitle>
                    <CardDescription>
                      {tagsStatus.all_exist
                        ? "Your Paperless instance has all required workflow tags configured."
                        : "Some workflow tags need to be created in Paperless for the pipeline to work correctly."}
                    </CardDescription>
                  </div>
                </div>
                <Badge
                  variant={tagsStatus.all_exist ? "default" : "secondary"}
                  className={tagsStatus.all_exist ? "bg-emerald-600" : ""}
                >
                  {tagsStatus.tags.filter((t) => t.exists).length}/{tagsStatus.tags.length} tags
                </Badge>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Success Message */}
        {successMessage && (
          <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {/* Error Message */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {loading && !tagsStatus && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                <p className="text-sm text-zinc-500">Checking workflow tags...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tags List */}
        {tagsStatus && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" />
                Workflow Tags
              </CardTitle>
              <CardDescription>
                These tags are used to track document processing status through the pipeline.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {tagsStatus.tags.map((tag) => (
                  <div
                    key={tag.key}
                    className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center ${
                          tag.exists
                            ? "bg-emerald-100 dark:bg-emerald-900/30"
                            : "bg-zinc-100 dark:bg-zinc-800"
                        }`}
                      >
                        {tag.exists ? (
                          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <X className="h-4 w-4 text-zinc-400" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{TAG_LABELS[tag.key] || tag.key}</span>
                          <Badge variant="outline" className="font-mono text-xs">
                            {tag.name}
                          </Badge>
                        </div>
                        <p className="text-sm text-zinc-500 mt-0.5">
                          {TAG_DESCRIPTIONS[tag.key] || "Workflow tracking tag"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {tag.exists ? (
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          Exists
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          Missing
                        </Badge>
                      )}
                      {tag.tag_id && (
                        <span className="text-xs text-zinc-400">ID: {tag.tag_id}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Help Section */}
        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardContent className="pt-6">
            <h3 className="font-medium mb-2">How Workflow Tags Work</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              The LLM processing pipeline uses these tags to track which stage each document has completed.
              When a document is added to Paperless with the <code className="bg-zinc-200 dark:bg-zinc-800 px-1 rounded">pending</code> tag,
              it enters the processing queue.
            </p>
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <span className="font-medium">Pipeline flow:</span>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-xs">pending</Badge>
                <span>→</span>
                <Badge variant="outline" className="text-xs">ocr_done</Badge>
                <span>→</span>
                <Badge variant="outline" className="text-xs">title_done</Badge>
                <span>→</span>
                <Badge variant="outline" className="text-xs">correspondent_done</Badge>
                <span>→</span>
                <Badge variant="outline" className="text-xs">tags_done</Badge>
                <span>→</span>
                <Badge variant="outline" className="text-xs">processed</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
