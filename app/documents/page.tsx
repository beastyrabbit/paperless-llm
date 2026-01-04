"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Search,
  Filter,
  Play,
  Eye,
  Clock,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import Link from "next/link";

interface Document {
  id: number;
  title: string;
  correspondent: string | null;
  created: string;
  tags: string[];
  processing_status: string | null;
}

const statusConfig: Record<string, { label: string; color: string; variant: "warning" | "info" | "secondary" | "success" | "destructive" }> = {
  pending: { label: "Pending", color: "bg-amber-500", variant: "warning" },
  ocr_done: { label: "OCR Done", color: "bg-blue-500", variant: "info" },
  title_done: { label: "Title Done", color: "bg-purple-500", variant: "secondary" },
  correspondent_done: { label: "Corr. Done", color: "bg-pink-500", variant: "secondary" },
  tags_done: { label: "Tags Done", color: "bg-orange-500", variant: "secondary" },
  processed: { label: "Complete", color: "bg-emerald-500", variant: "success" },
};

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async (tag?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (tag && tag !== "all") {
        // Map status filter to tag names from settings
        const settingsResponse = await fetch("http://localhost:8000/api/settings");
        if (settingsResponse.ok) {
          const settings = await settingsResponse.json();
          const tagMap: Record<string, string> = {
            pending: settings.tags.pending,
            ocr_done: settings.tags.ocr_done,
            title_done: settings.tags.title_done,
            correspondent_done: settings.tags.correspondent_done,
            tags_done: settings.tags.tags_done,
            processed: settings.tags.processed,
          };
          if (tagMap[tag]) {
            params.set("tag", tagMap[tag]);
          }
        }
      }

      const response = await fetch(`http://localhost:8000/api/documents/pending?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data);
      } else {
        setError("Failed to fetch documents");
      }
    } catch (err) {
      setError("Unable to connect to backend");
      console.error("Failed to fetch documents:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments(statusFilter);
  }, [fetchDocuments, statusFilter]);

  const filteredDocs = documents.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.correspondent?.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  const handleRefresh = () => {
    fetchDocuments(statusFilter);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Documents</h1>
            <p className="text-sm text-zinc-500">
              View and process documents in the queue
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Badge variant="secondary">{documents.length} documents</Badge>
          </div>
        </div>
      </header>

      <div className="p-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder="Search documents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="ocr_done">OCR Done</SelectItem>
              <SelectItem value="title_done">Title Done</SelectItem>
              <SelectItem value="correspondent_done">Corr. Done</SelectItem>
              <SelectItem value="tags_done">Tags Done</SelectItem>
              <SelectItem value="processed">Processed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Document List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Document Queue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                <Loader2 className="h-8 w-8 animate-spin mb-4 text-zinc-400" />
                <p className="text-sm">Loading documents...</p>
              </div>
            ) : (
              <ScrollArea className="h-[600px]">
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filteredDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-4 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                    >
                      {/* Icon */}
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                        <FileText className="h-5 w-5 text-zinc-500" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium truncate">{doc.title}</h3>
                          {doc.processing_status && statusConfig[doc.processing_status] && (
                            <Badge variant={statusConfig[doc.processing_status].variant}>
                              {statusConfig[doc.processing_status].label}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-zinc-500">
                          {doc.correspondent && (
                            <span className="truncate">{doc.correspondent}</span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(doc.created).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex gap-1 mt-2">
                          {doc.tags
                            .filter((t) => !t.startsWith("llm-"))
                            .slice(0, 5)
                            .map((tag) => (
                              <Badge key={tag} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          {doc.tags.filter((t) => !t.startsWith("llm-")).length > 5 && (
                            <Badge variant="outline" className="text-xs">
                              +{doc.tags.filter((t) => !t.startsWith("llm-")).length - 5}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {doc.processing_status !== "processed" && (
                          <Button size="sm" variant="outline">
                            <Play className="mr-1 h-3 w-3" />
                            Process
                          </Button>
                        )}
                        <Link href={`/documents/${doc.id}`}>
                          <Button size="sm" variant="ghost">
                            <Eye className="mr-1 h-3 w-3" />
                            View
                          </Button>
                        </Link>
                        <ChevronRight className="h-4 w-4 text-zinc-400" />
                      </div>
                    </div>
                  ))}

                  {filteredDocs.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                      <FileText className="h-12 w-12 mb-4 text-zinc-300" />
                      <p className="text-lg font-medium">No documents found</p>
                      <p className="text-sm">Try adjusting your search or filter</p>
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
