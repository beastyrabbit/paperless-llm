"use client";

import { useState, use } from "react";
import {
  ArrowLeft,
  Play,
  FileText,
  User,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";

interface StreamEvent {
  type: string;
  content?: string;
  model?: string;
  step?: string;
  title?: string;
  confirmed?: boolean;
  feedback?: string;
}

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const docId = resolvedParams.id;

  const [processing, setProcessing] = useState(false);
  const [streamOutput, setStreamOutput] = useState<StreamEvent[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const mockDocument = {
    id: parseInt(docId),
    title: "Rechnung Amazon - Januar 2024",
    correspondent: "Amazon",
    created: "2024-01-14",
    content: `AMAZON EU S.à r.l.
38 avenue John F. Kennedy
L-1855 Luxembourg

RECHNUNG

Rechnungsnummer: 123-4567890-1234567
Rechnungsdatum: 15. Januar 2024

Bestellung: 123-4567890-1234567
Bestelldatum: 12. Januar 2024

Lieferadresse:
Max Mustermann
Musterstraße 123
12345 Musterstadt
Deutschland

Artikel                                  Menge    Preis
-------------------------------------------------
USB-C Kabel (2m)                           2    €15,99
Wireless Mouse                             1    €29,99
Laptop Stand                               1    €45,99
-------------------------------------------------
Zwischensumme:                                  €91,97
MwSt. (19%):                                    €17,47
-------------------------------------------------
GESAMTBETRAG:                                  €109,44

Vielen Dank für Ihren Einkauf bei Amazon!`,
    tags: ["llm-ocr-done", "invoice"],
    status: "ocr_done",
  };

  const simulateProcessing = async () => {
    setProcessing(true);
    setStreamOutput([]);
    setProgress(0);

    const events: StreamEvent[] = [
      { type: "start", step: "title", model: "gpt-oss:120b" },
      { type: "thinking", content: "Analyzing document structure..." },
      { type: "thinking", content: "Identifying key information..." },
      { type: "token", content: "Based" },
      { type: "token", content: " on" },
      { type: "token", content: " the" },
      { type: "token", content: " document" },
      { type: "token", content: "," },
      { type: "token", content: " I" },
      { type: "token", content: " suggest" },
      { type: "token", content: " the" },
      { type: "token", content: " title" },
      { type: "token", content: ":" },
      { type: "token", content: " \"" },
      { type: "token", content: "Rechnung" },
      { type: "token", content: " Amazon" },
      { type: "token", content: " -" },
      { type: "token", content: " Januar" },
      { type: "token", content: " 2024" },
      { type: "token", content: "\"" },
      { type: "analysis_complete", title: "Rechnung Amazon - Januar 2024" },
      { type: "confirmation_start", model: "gpt-oss:20b" },
      { type: "confirmation_result", confirmed: true, feedback: "Title accurately describes the document content." },
      { type: "complete", step: "title" },
    ];

    for (let i = 0; i < events.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      setStreamOutput((prev) => [...prev, events[i]]);
      setProgress((i / events.length) * 100);

      if (events[i].step) {
        setCurrentStep(events[i].step ?? null);
      }
    }

    setProcessing(false);
    setProgress(100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <Link href="/documents">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Document #{docId}
              </h1>
              <p className="text-sm text-zinc-500">{mockDocument.title}</p>
            </div>
          </div>
          <Button onClick={simulateProcessing} disabled={processing}>
            {processing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {processing ? "Processing..." : "Process Document"}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 p-8 lg:grid-cols-2">
        {/* Document Preview */}
        <Card className="lg:row-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Document Content
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <pre className="font-mono text-sm whitespace-pre-wrap">
                {mockDocument.content}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Document Info */}
        <Card>
          <CardHeader>
            <CardTitle>Document Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-zinc-400" />
              <div>
                <p className="text-sm text-zinc-500">Correspondent</p>
                <p className="font-medium">{mockDocument.correspondent || "Not assigned"}</p>
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-sm text-zinc-500 mb-2">Tags</p>
              <div className="flex flex-wrap gap-2">
                {mockDocument.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant={tag.startsWith("llm-") ? "secondary" : "outline"}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Processing Stream */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-500" />
              LLM Processing Stream
            </CardTitle>
          </CardHeader>
          <CardContent>
            {processing && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-zinc-500">Processing: {currentStep}</span>
                  <span className="font-mono">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            <ScrollArea className="h-[300px] rounded-lg border border-zinc-200 bg-zinc-950 p-4 dark:border-zinc-800">
              <div className="font-mono text-sm text-emerald-400 space-y-1">
                {streamOutput.length === 0 && !processing && (
                  <p className="text-zinc-500">
                    Click &quot;Process Document&quot; to start...
                  </p>
                )}
                {streamOutput.map((event, i) => (
                  <div key={i} className="animate-fade-in">
                    {event.type === "start" && (
                      <p className="text-blue-400">
                        ▶ Starting {event.step} with {event.model}
                      </p>
                    )}
                    {event.type === "thinking" && (
                      <p className="text-zinc-400 italic">💭 {event.content}</p>
                    )}
                    {event.type === "token" && (
                      <span className="text-emerald-300">{event.content}</span>
                    )}
                    {event.type === "analysis_complete" && (
                      <p className="text-yellow-400 mt-2">
                        ✓ Suggested: &quot;{event.title}&quot;
                      </p>
                    )}
                    {event.type === "confirmation_start" && (
                      <p className="text-purple-400 mt-2">
                        🔍 Confirming with {event.model}...
                      </p>
                    )}
                    {event.type === "confirmation_result" && (
                      <p
                        className={
                          event.confirmed ? "text-emerald-400" : "text-red-400"
                        }
                      >
                        {event.confirmed ? "✓" : "✗"} {event.feedback}
                      </p>
                    )}
                    {event.type === "complete" && (
                      <p className="text-emerald-500 font-bold mt-2">
                        ✓ {event.step} complete!
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
