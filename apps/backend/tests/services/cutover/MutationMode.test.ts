import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../../../src/config/schema.js";
import {
  catalogApplyRequestAllowed,
  cutoverRuntimePlan,
  mutationModeRequestAllowed,
  scannerOptionsFromConfig,
} from "../../../src/services/cutover/mode.js";

type CutoverConfigOverride = Partial<Omit<ResolvedConfig["cutover"], "scanner">> & {
  readonly scanner?: Partial<ResolvedConfig["cutover"]["scanner"]>;
};

const cutover = (overrides: CutoverConfigOverride = {}): ResolvedConfig["cutover"] => ({
  mutationMode: "disabled",
  ...overrides,
  scanner: {
    scope: "disabled",
    canaryDocumentIds: [],
    aiAnalyseTagId: 0,
    configuredCustomFieldIds: [],
    systemTagIds: [],
    parentTagIds: [],
    workflowTagIds: [],
    ...overrides.scanner,
  },
});

describe("cutover mutation mode", () => {
  it("defaults to no writers and blocks both legacy and Paperless-first mutation endpoints", () => {
    const plan = cutoverRuntimePlan(cutover());

    expect(plan).toMatchObject({
      mutationMode: "disabled",
      startLegacyWorker: false,
      startPaperlessFirstScanner: false,
    });
    expect(cutover().scanner.aiAnalyseTagId).toBe(0);
    expect(mutationModeRequestAllowed("disabled", "GET", "/api/analysis/runs")).toBe(true);
    expect(mutationModeRequestAllowed("disabled", "POST", "/api/processing/42/start")).toBe(false);
    expect(mutationModeRequestAllowed("disabled", "POST", "/api/analysis/runs")).toBe(false);
  });

  it("keeps legacy and Paperless-first writers mutually exclusive", () => {
    expect(mutationModeRequestAllowed("legacy", "POST", "/api/processing/42/start")).toBe(true);
    expect(mutationModeRequestAllowed("legacy", "POST", "/api/analysis/runs")).toBe(false);
    expect(mutationModeRequestAllowed("paperless_first", "POST", "/api/processing/42/start")).toBe(
      false,
    );
    expect(mutationModeRequestAllowed("paperless_first", "GET", "/api/processing/42/stream")).toBe(
      false,
    );
    expect(mutationModeRequestAllowed("paperless_first", "POST", "/api/analysis/runs")).toBe(true);
    expect(
      catalogApplyRequestAllowed("paperless_first", {
        expectedProposalFingerprint: "sha256:proposal",
        expectedEvidenceFingerprint: "sha256:evidence",
      }),
    ).toBe(true);
    expect(catalogApplyRequestAllowed("paperless_first", {})).toBe(false);
    expect(catalogApplyRequestAllowed("legacy", {})).toBe(true);
    expect(
      catalogApplyRequestAllowed("legacy", { expectedProposalFingerprint: "sha256:proposal" }),
    ).toBe(false);
  });

  it("rejects invalid scanner combinations and disabled writer locks", () => {
    expect(() =>
      cutoverRuntimePlan(
        cutover({ mutationMode: "legacy", scanner: { scope: "canary", canaryDocumentIds: [42] } }),
      ),
    ).toThrow(/paperless_first/);
    expect(() =>
      cutoverRuntimePlan(
        cutover({ mutationMode: "paperless_first", scanner: { scope: "canary" } }),
      ),
    ).toThrow(/allowlist/);
    expect(() =>
      cutoverRuntimePlan(cutover({ mutationMode: "paperless_first", scanner: { scope: "all" } })),
    ).toThrow(/ai-analyse tag ID/);
    expect(() =>
      cutoverRuntimePlan(cutover({ mutationMode: "paperless_first" }), {
        PAPERLESS_LLM_BACKEND_WRITER_LOCK_ENABLED: "false",
      } as NodeJS.ProcessEnv),
    ).toThrow(/writer lock/);
  });

  it("projects explicit canary and full scanner configuration", () => {
    const canaryConfig = cutover({
      mutationMode: "paperless_first",
      scanner: {
        scope: "canary",
        canaryDocumentIds: [42, 7],
        aiAnalyseTagId: 100,
      },
    });
    const fullConfig = cutover({
      mutationMode: "paperless_first",
      scanner: { scope: "all", aiAnalyseTagId: 100 },
    });

    expect(cutoverRuntimePlan(canaryConfig)).toMatchObject({
      startLegacyWorker: false,
      startPaperlessFirstScanner: true,
      scannerScope: "canary",
    });
    expect(
      scannerOptionsFromConfig(canaryConfig, {
        configuredCustomFieldIds: [],
        systemTagIds: [],
        parentTagIds: [],
        workflowTagIds: [],
        aiAnalyseTagId: 100,
      }),
    ).toMatchObject({
      enabled: true,
      scope: "canary",
      canaryDocumentIds: [42, 7],
      aiAnalyseTagId: 100,
      configuredCustomFieldIds: [],
      systemTagIds: [],
      parentTagIds: [],
      workflowTagIds: [],
    });
    expect(cutoverRuntimePlan(fullConfig).scannerScope).toBe("all");
  });
});
