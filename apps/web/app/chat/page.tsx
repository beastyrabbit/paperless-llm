"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  MessageSquare,
  Send,
  Loader2,
  AlertCircle,
  FileText,
  User,
  Bot,
  ExternalLink,
  Trash2,
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
import { chatApi, ChatMessage, SearchResult, settingsApi } from "@/lib/api";

interface DisplayMessage extends ChatMessage {
  sources?: SearchResult[];
}

export default function ChatPage() {
  const t = useTranslations("chat");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paperlessUrl, setPaperlessUrl] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: DisplayMessage = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      // Send all messages for context
      const chatMessages: ChatMessage[] = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await chatApi.send(chatMessages);

      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        const assistantMessage: DisplayMessage = {
          role: "assistant",
          content: res.data.message,
          sources: res.data.sources,
        };
        setMessages([...updatedMessages, assistantMessage]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
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
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleClear}>
              <Trash2 className="h-4 w-4 mr-2" />
              {t("clearChat")}
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-col h-[calc(100vh-56px)]">
        {/* Messages Area */}
        <div className="flex-1 overflow-hidden p-6">
          <Card className="h-full flex flex-col">
            <CardHeader className="py-3 px-4 border-b flex-shrink-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                {t("conversation")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-4">
                  {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                      <Bot className="h-12 w-12 mb-3 text-zinc-300" />
                      <p className="font-medium">{t("welcomeTitle")}</p>
                      <p className="text-sm text-zinc-400 text-center max-w-md mt-2">
                        {t("welcomeMessage")}
                      </p>
                    </div>
                  )}

                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex gap-3 ${
                        message.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      {message.role === "assistant" && (
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                          <Bot className="h-4 w-4 text-emerald-600" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] ${
                          message.role === "user"
                            ? "bg-emerald-600 text-white rounded-2xl rounded-tr-sm px-4 py-2"
                            : "bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-tl-sm px-4 py-2"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>

                        {/* Sources */}
                        {message.sources && message.sources.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                              {t("sources")}:
                            </p>
                            <div className="space-y-1">
                              {message.sources.slice(0, 3).map((source) => (
                                <button
                                  key={source.docId}
                                  onClick={() => openDocument(source.docId)}
                                  className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 hover:underline w-full text-left"
                                >
                                  <FileText className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">{source.title}</span>
                                  <Badge variant="outline" className="text-xs ml-auto flex-shrink-0">
                                    {(source.score * 100).toFixed(0)}%
                                  </Badge>
                                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      {message.role === "user" && (
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                          <User className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                        </div>
                      )}
                    </div>
                  ))}

                  {loading && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-tl-sm px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                          <span className="text-sm text-zinc-500">{t("thinking")}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                        <AlertCircle className="h-4 w-4 text-red-600" />
                      </div>
                      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl rounded-tl-sm px-4 py-2 text-red-700 dark:text-red-400 text-sm">
                        {error}
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Input Area */}
        <div className="flex-shrink-0 p-6 pt-0">
          <Card>
            <CardContent className="p-3">
              <div className="flex gap-3">
                <Input
                  placeholder={t("inputPlaceholder")}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  className="flex-1"
                />
                <Button onClick={handleSend} disabled={loading || !input.trim()}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
