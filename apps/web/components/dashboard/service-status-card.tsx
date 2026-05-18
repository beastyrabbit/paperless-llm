"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { Settings } from "@/lib/api";
import type { ConnectionStatus, ServiceInfo } from "./types";

interface ServiceStatusCardProps {
  settings: Settings | null;
  connections: ConnectionStatus;
}

export function ServiceStatusCard({ settings, connections }: ServiceStatusCardProps) {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");

  const services = useMemo<ServiceInfo[]>(
    () => [
      {
        name: tServices("paperless"),
        key: "paperless",
        url: settings?.paperless_url || tCommon("notConfigured"),
      },
      {
        name: tServices("ollama"),
        key: "ollama",
        url: settings?.ollama_url || tCommon("notConfigured"),
      },
      {
        name: tServices("qdrant"),
        key: "qdrant",
        url: settings?.qdrant_url || tCommon("notConfigured"),
      },
      {
        name: tServices("mistral"),
        key: "mistral",
        url: settings?.mistral_api_key ? tCommon("apiKeyConfigured") : tCommon("notConfigured"),
      },
    ],
    [settings, tCommon, tServices],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("serviceConnections")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {services.map((service) => (
          <div
            key={service.key}
            className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="flex items-center gap-3">
              <div
                aria-label={`${service.name}: ${connections[service.key]}`}
                role="status"
                className={`h-2.5 w-2.5 rounded-full ${
                  connections[service.key] === "connected"
                    ? "bg-emerald-500"
                    : connections[service.key] === "checking"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-red-500"
                }`}
              />
              <div>
                <p className="text-sm font-medium">{service.name}</p>
                <p className="max-w-[200px] truncate text-xs text-zinc-500">{service.url}</p>
              </div>
            </div>
            <Badge
              variant={
                connections[service.key] === "connected"
                  ? "success"
                  : connections[service.key] === "checking"
                    ? "warning"
                    : "destructive"
              }
            >
              {connections[service.key] === "connected"
                ? tCommon("connected")
                : connections[service.key] === "checking"
                  ? tCommon("checking")
                  : tCommon("disconnected")}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
