"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  FileText,
  User,
  Tag,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Badge,
  ScrollArea,
} from "@repo/ui";
import { searchApi, SearchResult, settingsApi } from "@/lib/api";
import { useEffect } from "react";

export default function SearchPage() {
  const t = useTranslations("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [paperlessUrl, setPaperlessUrl] = useState<string>("");

  // Fetch Paperless URL for document links
  useEffect(() => {
    async function fetchSettings() {
      const res = await settingsApi.get();
      if (res.data) {
        setPaperlessUrl(res.data.paperless_external_url || res.data.paperless_url || "");
      }
    }
    fetchSettings();
  }, []);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const res = await searchApi.search(query, 20);
      if (res.error) {
        setError(res.error);
        setResults([]);
      } else if (res.data) {
        setResults(res.data.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const openDocument = (docId: number) => {
    if (paperlessUrl) {
      window.open(`${paperlessUrl}/documents/${docId}/details`, "_blank");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-14 items-center justify-between px-6">
          <div>
            <h1 className="text-lg font-bold tracking-tight">{t("title")}</h1>
            <p className="text-xs text-zinc-500">{t("subtitle")}</p>
          </div>
        </div>
      </header>

      <div className="p-6">
        {/* Search Input */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  placeholder={t("searchPlaceholder")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="pl-9"
                />
              </div>
              <Button onClick={handleSearch} disabled={loading || !query.trim()}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                {t("searchButton")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          </div>
        )}

        {/* Results */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">
              {hasSearched
                ? t("resultsCount", { count: results.length })
                : t("enterQuery")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                <Loader2 className="h-6 w-6 animate-spin mb-3 text-zinc-400" />
                <p className="text-sm">{t("searching")}</p>
              </div>
            ) : (
              <ScrollArea className="h-[calc(100vh-340px)]">
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {results.map((result) => (
                    <div
                      key={result.docId}
                      className="px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 cursor-pointer transition-colors"
                      onClick={() => openDocument(result.docId)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                            <span className="font-medium truncate" title={result.title}>
                              {result.title}
                            </span>
                            <span className="text-xs text-zinc-400">#{result.docId}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                            {result.correspondent && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {result.correspondent}
                              </span>
                            )}
                            {result.documentType && (
                              <Badge variant="outline" className="text-xs">
                                {result.documentType}
                              </Badge>
                            )}
                            {result.tags.length > 0 && (
                              <span className="flex items-center gap-1">
                                <Tag className="h-3 w-3" />
                                {result.tags.slice(0, 3).join(", ")}
                                {result.tags.length > 3 && ` +${result.tags.length - 3}`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge
                            variant={result.score > 0.7 ? "default" : result.score > 0.4 ? "secondary" : "outline"}
                            className="text-xs"
                          >
                            {(result.score * 100).toFixed(0)}%
                          </Badge>
                          <ExternalLink className="h-4 w-4 text-zinc-400" />
                        </div>
                      </div>
                    </div>
                  ))}

                  {hasSearched && results.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                      <Search className="h-10 w-10 mb-3 text-zinc-300" />
                      <p className="font-medium">{t("noResults")}</p>
                      <p className="text-sm text-zinc-400">{t("tryDifferent")}</p>
                    </div>
                  )}

                  {!hasSearched && (
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                      <Search className="h-10 w-10 mb-3 text-zinc-300" />
                      <p className="font-medium">{t("startSearching")}</p>
                      <p className="text-sm text-zinc-400">{t("searchHint")}</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
