/**
 * Jobs API endpoints
 */
import { fetchApi } from "./client";
import type {
  JobStatus,
  BootstrapAnalysisType,
  BootstrapProgress,
  BootstrapStartResponse,
  JobScheduleStatus,
  ScheduleUpdateRequest,
  ScheduleUpdateResponse,
  BulkOCRProgress,
  BulkOCRStartResponse,
} from "./types";

export const jobsApi = {
  getStatus: () => fetchApi<Record<string, JobStatus>>("/api/jobs/status"),

  getJobStatus: (jobName: string) =>
    fetchApi<JobStatus>(`/api/jobs/status/${jobName}`),

  triggerMetadataEnhancement: () =>
    fetchApi<{ message: string; status: string }>(
      "/api/jobs/metadata-enhancement/run",
      {
        method: "POST",
      }
    ),

  triggerSchemaCleanup: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/schema-cleanup/run", {
      method: "POST",
    }),

  // Bootstrap Analysis
  startBootstrap: (analysisType: BootstrapAnalysisType) =>
    fetchApi<BootstrapStartResponse>("/api/jobs/bootstrap/start", {
      method: "POST",
      body: JSON.stringify({ analysis_type: analysisType }),
    }),

  getBootstrapStatus: () =>
    fetchApi<BootstrapProgress>("/api/jobs/bootstrap/status"),

  cancelBootstrap: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/bootstrap/cancel", {
      method: "POST",
    }),

  skipBootstrapDocument: (count: number = 1) =>
    fetchApi<{ message: string; status: string; count?: number }>(
      `/api/jobs/bootstrap/skip?count=${count}`,
      {
        method: "POST",
      }
    ),

  // Job Schedules
  getSchedules: () => fetchApi<JobScheduleStatus>("/api/jobs/schedule"),

  updateSchedule: (request: ScheduleUpdateRequest) =>
    fetchApi<ScheduleUpdateResponse>("/api/jobs/schedule", {
      method: "PATCH",
      body: JSON.stringify(request),
    }),

  // Bulk OCR
  startBulkOCR: (docsPerSecond: number, skipExisting: boolean) =>
    fetchApi<BulkOCRStartResponse>("/api/jobs/bulk-ocr/start", {
      method: "POST",
      body: JSON.stringify({
        docs_per_second: docsPerSecond,
        skip_existing: skipExisting,
      }),
    }),

  getBulkOCRStatus: () => fetchApi<BulkOCRProgress>("/api/jobs/bulk-ocr/status"),

  cancelBulkOCR: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/bulk-ocr/cancel", {
      method: "POST",
    }),
};
