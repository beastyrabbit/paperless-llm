"use client";

import React, { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
} from "@repo/ui";
import {
  Play,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

const API_BASE = "";

interface JobStatus {
  job_name: string;
  status: "idle" | "running" | "completed" | "failed";
  last_run: string | null;
  last_result: Record<string, unknown> | null;
}

const JOB_DESCRIPTIONS: Record<string, string> = {
  metadata_enhancement: "Suggests descriptions for entities without metadata",
  schema_cleanup: "Identifies duplicates and suggests merging/renaming",
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
    // Poll for status every 5 seconds
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/jobs/status`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setJobs(data);
    } catch (error) {
      console.error("Failed to fetch job status:", error);
    } finally {
      setLoading(false);
    }
  };

  const triggerJob = async (jobName: string) => {
    try {
      await fetch(`${API_BASE}/api/jobs/${jobName}/run`, {
        method: "POST",
      });
      // Immediately refresh status
      await fetchStatus();
    } catch (error) {
      console.error("Failed to trigger job:", error);
    }
  };

  const getStatusBadge = (status: string) => {
    const config: Record<
      string,
      {
        variant: "default" | "secondary" | "destructive" | "outline";
        icon: React.ReactElement;
      }
    > = {
      idle: {
        variant: "secondary",
        icon: <Clock className="h-3 w-3 mr-1" />,
      },
      running: {
        variant: "default",
        icon: <Loader2 className="h-3 w-3 mr-1 animate-spin" />,
      },
      completed: {
        variant: "outline",
        icon: <CheckCircle className="h-3 w-3 mr-1" />,
      },
      failed: {
        variant: "destructive",
        icon: <XCircle className="h-3 w-3 mr-1" />,
      },
    };
    const { variant, icon } = config[status] || config.idle;
    return (
      <Badge variant={variant} className="flex items-center">
        {icon}
        {status}
      </Badge>
    );
  };

  const formatJobName = (name: string) => {
    return name
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const JobCard = ({
    jobKey,
    jobStatus,
  }: {
    jobKey: string;
    jobStatus: JobStatus;
  }) => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{formatJobName(jobKey)}</CardTitle>
          {getStatusBadge(jobStatus.status)}
        </div>
        <CardDescription>
          {JOB_DESCRIPTIONS[jobKey] || `Background job: ${jobKey}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {jobStatus.last_run && (
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">Last run:</span>{" "}
              {new Date(jobStatus.last_run).toLocaleString()}
            </div>
          )}

          {jobStatus.last_result && (
            <div className="text-sm">
              <span className="font-medium">Last result:</span>
              <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto max-h-48">
                {JSON.stringify(jobStatus.last_result, null, 2)}
              </pre>
            </div>
          )}

          <Button
            onClick={() => triggerJob(jobKey)}
            disabled={jobStatus.status === "running"}
            className="w-full"
          >
            {jobStatus.status === "running" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Run Now
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

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
              <h1 className="text-xl font-bold tracking-tight">
                Background Jobs
              </h1>
              <p className="text-sm text-zinc-500">
                Manage and trigger background processing jobs
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchStatus}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </header>

      <div className="p-8 max-w-4xl mx-auto space-y-6">
        {/* Loading State */}
        {loading && Object.keys(jobs).length === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                <p className="text-sm text-zinc-500">Loading job status...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Jobs Grid */}
        {!loading && Object.keys(jobs).length > 0 && (
          <div className="grid gap-6 md:grid-cols-2">
            {Object.entries(jobs).map(([key, status]) => (
              <JobCard key={key} jobKey={key} jobStatus={status} />
            ))}
          </div>
        )}

        {/* No Jobs Available */}
        {!loading && Object.keys(jobs).length === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
                <Clock className="h-12 w-12 text-zinc-300" />
                <p className="text-lg font-medium">No Background Jobs Available</p>
                <p className="text-sm">
                  Background jobs will appear here once they are configured.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Help Section */}
        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardContent className="pt-6">
            <h3 className="font-medium mb-2">About Background Jobs</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Background jobs run asynchronously to perform maintenance and
              enhancement tasks on your document metadata.
            </p>
            <div className="grid gap-3 text-sm">
              <div className="flex items-start gap-2 text-zinc-500">
                <CheckCircle className="h-4 w-4 mt-0.5 text-emerald-500" />
                <span>
                  <strong>Metadata Enhancement:</strong> Analyzes entities
                  without descriptions and suggests improvements using AI.
                </span>
              </div>
              <div className="flex items-start gap-2 text-zinc-500">
                <CheckCircle className="h-4 w-4 mt-0.5 text-emerald-500" />
                <span>
                  <strong>Schema Cleanup:</strong> Identifies duplicate or
                  similar entities and suggests merging or renaming for better
                  organization.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
