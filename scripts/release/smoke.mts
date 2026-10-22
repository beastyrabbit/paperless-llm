import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface Version {
  version: string;
  revision: string;
}

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const isNewer = (actual: string, expected: string): boolean => {
  if (!stableVersion.test(actual) || !stableVersion.test(expected)) return false;
  const actualParts = actual.split(".").map(BigInt);
  const expectedParts = expected.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (actualParts[i] !== expectedParts[i]) {
      return (actualParts[i] ?? 0n) > (expectedParts[i] ?? 0n);
    }
  }
  return false;
};

export function deploymentState(versions: Version[], expected: Version) {
  if (versions.some((value) => isNewer(value.version, expected.version))) return "superseded";
  if (
    versions.length === 2 &&
    versions.every(
      (value) => value.version === expected.version && value.revision === expected.revision,
    )
  )
    return "deployed";
  return "waiting";
}

export async function pollDeployment({
  baseUrl,
  expected,
  request = fetch,
  timeoutMs = 25 * 60_000,
  intervalMs = 15_000,
  now = Date.now,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}: {
  baseUrl: string;
  expected: Version;
  request?: typeof fetch;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Promise<"deployed" | "superseded"> {
  if (!stableVersion.test(expected.version) || !/^[a-f0-9]{40}$/.test(expected.revision)) {
    throw new Error("Smoke check requires a stable version and full commit revision.");
  }
  const deadline = now() + timeoutMs;
  const get = async (path: string, requestDeadline = deadline) => {
    const response = await request(new URL(path, baseUrl), {
      method: "GET",
      headers: { "Cache-Control": "no-cache, no-store" },
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, requestDeadline - now()))),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`${path}: HTTP ${response.status}`);
    }
    return response;
  };

  // This Service exposes only the frontend port. /api/version proxies to the backend.
  // Recreate rollouts temporarily remove all Service endpoints. Allow that outage
  // before polling versions, within the same overall deployment deadline.
  const reachabilityDeadline = Math.min(deadline, now() + 5 * 60_000);
  let reachable = false;
  while (now() < reachabilityDeadline) {
    try {
      const response = await get("/", reachabilityDeadline);
      await response.body?.cancel();
      reachable = true;
      break;
    } catch (error) {
      log(
        `Waiting for Service reachability: ${error instanceof Error ? error.message : "request failed"}`,
      );
    }
    await sleep(Math.min(intervalMs, Math.max(0, reachabilityDeadline - now())));
  }
  if (!reachable) throw new Error(`Timed out waiting for Service reachability: ${baseUrl}`);
  log(`Service reachable: ${baseUrl}`);

  while (now() < deadline) {
    let state: ReturnType<typeof deploymentState> = "waiting";
    try {
      const results = await Promise.allSettled(
        ["/version", "/api/version"].map(async (path) => {
          const value: unknown = await (await get(path)).json();
          if (
            !value ||
            typeof value !== "object" ||
            !("version" in value) ||
            typeof value.version !== "string" ||
            !("revision" in value) ||
            typeof value.revision !== "string"
          )
            throw new Error(`${path}: invalid version metadata`);
          return { version: value.version, revision: value.revision };
        }),
      );
      const versions = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      for (const result of results) {
        if (result.status === "rejected") {
          log(
            `Waiting for version endpoint: ${result.reason instanceof Error ? result.reason.message : "request failed"}`,
          );
        }
      }
      state = deploymentState(versions, expected);
      log(
        `Versions: ${versions.map((value) => `${value.version}@${value.revision}`).join(", ")}; ${state}`,
      );
    } catch (error) {
      log(
        `Waiting for version endpoints: ${error instanceof Error ? error.message : "request failed"}`,
      );
    }
    if (state === "superseded") return state;
    if (state === "deployed") {
      const page = await get("/privacy");
      const html = await page.text();
      if (!page.headers.get("content-type")?.includes("text/html") || !/<html[\s>]/i.test(html)) {
        throw new Error("Deployed /privacy did not return an HTML page.");
      }
      log("Deployed /privacy page passed.");
      return state;
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  throw new Error(
    `Timed out waiting for frontend and backend ${expected.version}@${expected.revision}.`,
  );
}

async function main() {
  const result = await pollDeployment({
    baseUrl:
      process.env.SERVICE_URL ?? "http://paperless-local-llm.documents.svc.cluster.local:3765",
    expected: {
      version: process.env.APP_VERSION ?? "",
      revision: process.env.APP_REVISION ?? "",
    },
  });
  const message =
    result === "deployed"
      ? "Flux deployment verified: both image versions and revisions match; /privacy passed."
      : "Superseded: a newer version is already serving. This release was not verified as deployed.";
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
