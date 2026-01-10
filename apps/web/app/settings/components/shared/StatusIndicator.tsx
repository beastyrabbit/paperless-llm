"use client";

import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { type ConnectionStatus } from "./types";

interface StatusIndicatorProps {
  status: ConnectionStatus;
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  switch (status) {
    case "testing":
      return <Loader2 className="h-4 w-4 animate-spin text-amber-500" />;
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return (
        <div className="h-4 w-4 rounded-full bg-zinc-300 dark:bg-zinc-600" />
      );
  }
}
