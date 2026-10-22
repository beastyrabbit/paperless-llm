import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const releaseVersion = (ref: string): string => {
  const match = /^refs\/tags\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(ref);
  if (!match?.[1])
    throw new Error("Release requires a stable vX.Y.Z tag, including manual dispatch.");
  return match[1];
};

export interface WorkflowRun {
  id: number;
  run_number: number;
  run_attempt: number;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export async function waitForQuality({
  sha,
  listRuns,
  timeoutMs = 10 * 60_000,
  intervalMs = 10_000,
  now = Date.now,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}: {
  sha: string;
  listRuns: () => Promise<WorkflowRun[]>;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Promise<WorkflowRun> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const runs = await listRuns(); // API errors fail closed, never fall back to an older success.
    const newest = runs
      .filter((run) => run.head_sha === sha && run.head_branch === "main" && run.event === "push")
      .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
    if (newest) {
      log(`Quality run: ${newest.html_url} (${newest.status}/${newest.conclusion ?? "pending"})`);
      if (newest.status === "completed") {
        if (newest.conclusion !== "success") {
          throw new Error(`Newest exact-commit main push check concluded ${newest.conclusion}.`);
        }
        return newest;
      }
    } else {
      log(`Waiting for pr.yml push/main checks for ${sha}.`);
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  throw new Error(`Timed out waiting for successful pr.yml push/main checks for ${sha}.`);
}

export async function listQualityRuns({
  repository,
  sha,
  token,
  request = fetch,
}: {
  repository: string;
  sha: string;
  token: string;
  request?: typeof fetch;
}): Promise<WorkflowRun[]> {
  const query = new URLSearchParams({
    event: "push",
    branch: "main",
    head_sha: sha,
    per_page: "100",
  });
  const response = await request(
    `https://api.github.com/repos/${repository}/actions/workflows/pr.yml/runs?${query}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    },
  );
  if (!response.ok) throw new Error(`Quality runs API returned HTTP ${response.status}.`);
  const data = (await response.json()) as { workflow_runs: WorkflowRun[] };
  if (!Array.isArray(data.workflow_runs)) throw new Error("Invalid quality runs API response.");
  return data.workflow_runs;
}

async function main() {
  const version = releaseVersion(process.env.GITHUB_REF ?? "");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const output = process.env.GITHUB_OUTPUT;
  if (!token || !repository || !output) throw new Error("Missing GitHub gate environment.");
  const run = await waitForQuality({
    sha,
    listRuns: () => listQualityRuns({ repository, sha, token }),
  });
  appendFileSync(output, `version=${version}\nrevision=${sha}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Release ${version} at ${sha}\n\nQuality: ${run.html_url}\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
