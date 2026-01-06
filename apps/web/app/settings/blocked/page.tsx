"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Trash2,
  Ban,
  User,
  FileText,
  Tag,
  Globe,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface BlockedSuggestion {
  id: number;
  suggestion_name: string;
  normalized_name: string;
  block_type: string;
  rejection_reason: string | null;
  rejection_category: string | null;
  doc_id: number | null;
  created_at: string;
}

const BLOCK_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  global: { label: "Global", icon: <Globe className="h-4 w-4" />, variant: "destructive" },
  correspondent: { label: "Correspondent", icon: <User className="h-4 w-4" />, variant: "default" },
  document_type: { label: "Document Type", icon: <FileText className="h-4 w-4" />, variant: "secondary" },
  tag: { label: "Tag", icon: <Tag className="h-4 w-4" />, variant: "outline" },
};

const CATEGORY_LABELS: Record<string, string> = {
  duplicate: "Duplicate",
  too_generic: "Too Generic",
  irrelevant: "Irrelevant",
  wrong_format: "Wrong Format",
  other: "Other",
};

export default function BlockedSuggestionsPage() {
  const [suggestions, setSuggestions] = useState<BlockedSuggestion[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchBlocked = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filter === "all"
        ? `${API_BASE}/api/schema/blocked`
        : `${API_BASE}/api/schema/blocked?block_type=${filter}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setSuggestions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch blocked suggestions");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchBlocked();
  }, [fetchBlocked]);

  const handleUnblock = async (id: number) => {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/schema/blocked/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      await fetchBlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unblock suggestion");
    } finally {
      setDeletingId(null);
    }
  };

  const getBlockTypeConfig = (type: string) => {
    return BLOCK_TYPE_CONFIG[type] || { label: type, icon: <Ban className="h-4 w-4" />, variant: "default" as const };
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <Link href="/settings">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Settings
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Blocked Suggestions</h1>
              <p className="text-sm text-zinc-500">
                Manage suggestions that should never be recommended by the AI
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchBlocked}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      <div className="p-8 max-w-4xl mx-auto space-y-6">
        {/* Error Message */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Filter */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Ban className="h-5 w-5" />
                  Blocked Suggestions
                </CardTitle>
                <CardDescription className="mt-1">
                  These suggestions will not be recommended by the AI in future document processing.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filter by type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="global">Global</SelectItem>
                    <SelectItem value="correspondent">Correspondent</SelectItem>
                    <SelectItem value="document_type">Document Type</SelectItem>
                    <SelectItem value="tag">Tag</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Loading State */}
            {loading && suggestions.length === 0 && (
              <div className="py-12">
                <div className="flex flex-col items-center justify-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                  <p className="text-sm text-zinc-500">Loading blocked suggestions...</p>
                </div>
              </div>
            )}

            {/* Empty State */}
            {!loading && suggestions.length === 0 && (
              <div className="py-12">
                <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
                  <Ban className="h-12 w-12 text-zinc-300" />
                  <p className="text-lg font-medium">No Blocked Suggestions</p>
                  <p className="text-sm">
                    {filter === "all"
                      ? "No suggestions have been blocked yet."
                      : `No blocked suggestions of type "${BLOCK_TYPE_CONFIG[filter]?.label || filter}".`}
                  </p>
                </div>
              </div>
            )}

            {/* Suggestions List */}
            {suggestions.length > 0 && (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {suggestions.map((item) => {
                  const typeConfig = getBlockTypeConfig(item.block_type);
                  const isDeleting = deletingId === item.id;

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                          {typeConfig.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">
                              {item.suggestion_name}
                            </span>
                            <Badge variant={typeConfig.variant}>
                              {typeConfig.label}
                            </Badge>
                            {item.rejection_category && (
                              <Badge variant="outline" className="text-xs">
                                {CATEGORY_LABELS[item.rejection_category] || item.rejection_category}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500">
                            {item.rejection_reason && (
                              <span className="truncate max-w-md">
                                {item.rejection_reason}
                              </span>
                            )}
                            {!item.rejection_reason && (
                              <span className="text-zinc-400 italic">No reason provided</span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-400 mt-1">
                            Blocked on {formatDate(item.created_at)}
                            {item.doc_id && (
                              <span className="ml-2">
                                from document #{item.doc_id}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnblock(item.id)}
                          disabled={isDeleting}
                          className="text-zinc-500 hover:text-red-600"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          <span className="ml-1 hidden sm:inline">Unblock</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Help Section */}
        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardContent className="pt-6">
            <h3 className="font-medium mb-2">How Blocked Suggestions Work</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              When a suggestion is blocked, the AI will never recommend it again for future documents.
              This helps improve the quality of suggestions over time by learning from your feedback.
            </p>
            <div className="grid gap-3 text-sm">
              <div className="flex items-center gap-2 text-zinc-500">
                <Globe className="h-4 w-4 text-red-500" />
                <span><strong>Global:</strong> Blocked across all categories</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <User className="h-4 w-4" />
                <span><strong>Correspondent:</strong> Will not be suggested as a correspondent</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <FileText className="h-4 w-4" />
                <span><strong>Document Type:</strong> Will not be suggested as a document type</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <Tag className="h-4 w-4" />
                <span><strong>Tag:</strong> Will not be suggested as a tag</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
