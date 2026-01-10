"use client";

import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { ConnectionStatus } from "./types";

export function StatusIndicator({ status }: { status: ConnectionStatus }) {
  switch (status) {
    case "testing":
      return <Loader2 className="h-4 w-4 animate-spin text-amber-500" />;
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <div className="h-4 w-4 rounded-full bg-zinc-300 dark:bg-zinc-600" />;
  }
}

export function formatETA(seconds: number): string {
  if (seconds < 60) {
    return `~${seconds}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `~${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `~${hours}h ${mins}m`;
  }
}
