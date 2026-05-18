"use client";

import { APP_PAGE_BACKGROUND } from "@/lib/styles";
import { useMemo } from "react";
import { CaseFlowCard } from "@/components/dashboard/case-flow-card";
import { getCaseMetrics } from "@/components/dashboard/case-metrics";
import { CasesSummaryCard } from "@/components/dashboard/cases-summary-card";
import { CurrentlyProcessingCard } from "@/components/dashboard/currently-processing-card";
import { DashboardErrorBanner } from "@/components/dashboard/dashboard-error-banner";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { ServiceStatusCard } from "@/components/dashboard/service-status-card";
import { StatsGrid } from "@/components/dashboard/stats-grid";
import { useDashboardData } from "@/components/dashboard/use-dashboard-data";

export default function Dashboard() {
  const {
    settings,
    stats,
    caseRecords,
    autoStatus,
    ollamaStatus,
    connections,
    loading,
    errorKey,
    refresh,
  } = useDashboardData();

  const caseMetrics = useMemo(
    () => getCaseMetrics(caseRecords, autoStatus),
    [caseRecords, autoStatus],
  );
  const allConnected = Object.values(connections).every((status) => status === "connected");
  const anyChecking = Object.values(connections).some((status) => status === "checking");

  return (
    <div className={APP_PAGE_BACKGROUND}>
      <DashboardHeader
        loading={loading}
        allConnected={allConnected}
        anyChecking={anyChecking}
        onRefresh={refresh}
      />

      <div className="p-8 stagger-children">
        <DashboardErrorBanner errorKey={errorKey} />
        <CurrentlyProcessingCard autoStatus={autoStatus} ollamaStatus={ollamaStatus} />
        <StatsGrid loading={loading} stats={stats} caseMetrics={caseMetrics} />
        <CaseFlowCard caseMetrics={caseMetrics} />

        <div className="grid gap-6 lg:grid-cols-2">
          <CasesSummaryCard loading={loading} caseMetrics={caseMetrics} />
          <ServiceStatusCard settings={settings} connections={connections} />
        </div>
      </div>
    </div>
  );
}
