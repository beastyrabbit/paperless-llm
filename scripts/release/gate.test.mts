import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { listQualityRuns, releaseVersion, type WorkflowRun, waitForQuality } from "./gate.mts";

const sha = "a".repeat(40);

test("gate entry point requires the full checked-out revision before any API call", () => {
  for (const revision of ["", "main", "a".repeat(39), sha]) {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", fileURLToPath(new URL("./gate.mts", import.meta.url))],
      {
        encoding: "utf8",
        env: { GITHUB_REF: "refs/tags/v1.2.3", RELEASE_REVISION: revision },
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      revision === sha ? /Missing GitHub gate environment/ : /Missing full checked-out commit revision/,
    );
  }
});
const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: 1,
  run_number: 1,
  run_attempt: 1,
  head_sha: sha,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/owner/repo/actions/runs/1",
  ...overrides,
});

function gate(snapshots: WorkflowRun[][]) {
  let time = 0;
  let calls = 0;
  const logs: string[] = [];
  const result = waitForQuality({
    sha,
    timeoutMs: 30,
    intervalMs: 10,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    listRuns: async () => snapshots[Math.min(calls++, snapshots.length - 1)] ?? [],
    log: (message) => logs.push(message),
  });
  return { result, logs, calls: () => calls };
}

test("accepts exact commit push/main and logs its run URL", async () => {
  const check = gate([[run()]]);
  assert.equal((await check.result).head_sha, sha);
  assert.ok(check.logs.some((message) => message.includes(run().html_url)));
});

for (const [label, runs] of [
  ["wrong SHA", [run({ head_sha: "b".repeat(40) })]],
  ["missing", []],
  ["PR", [run({ event: "pull_request" })]],
  ["manual", [run({ event: "workflow_dispatch" })]],
  ["wrong branch", [run({ head_branch: "feature" })]],
] as const) {
  test(`fails closed when ${label}`, async () => {
    const check = gate([[...runs]]);
    await assert.rejects(check.result, /Timed out/);
    assert.equal(check.calls(), 3);
  });
}

for (const conclusion of ["failure", "cancelled", "skipped", "timed_out", "neutral", null]) {
  test(`rejects completed/${conclusion}`, async () => {
    const check = gate([[run({ conclusion })]]);
    await assert.rejects(check.result, /concluded/);
    assert.equal(check.calls(), 1);
  });
}

test("waits through queued and in-progress to success", async () => {
  const check = gate([
    [run({ status: "queued", conclusion: null })],
    [run({ status: "in_progress", conclusion: null })],
    [run()],
  ]);
  await check.result;
  assert.equal(check.calls(), 3);
});

test("times out a permanently in-progress run", async () => {
  await assert.rejects(
    gate([[run({ status: "in_progress", conclusion: null })]]).result,
    /Timed out/,
  );
});

test("newer failure wins over an older success even if returned out of order", async () => {
  await assert.rejects(
    gate([[run(), run({ id: 2, run_number: 2, conclusion: "failure" })]]).result,
    /concluded failure/,
  );
});

test("a newer attempt cannot reuse the previous attempt's success", async () => {
  await assert.rejects(
    gate([[run(), run({ run_attempt: 2, conclusion: "failure" })]]).result,
    /concluded failure/,
  );
});

test("queries only pr.yml push/main at the exact SHA", async () => {
  const runs = await listQualityRuns({
    repository: "owner/repo",
    sha,
    token: "test-only",
    request: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/repos/owner/repo/actions/workflows/pr.yml/runs");
      assert.equal(url.searchParams.get("head_sha"), sha);
      assert.equal(url.searchParams.get("branch"), "main");
      assert.equal(url.searchParams.get("event"), "push");
      assert.equal(url.searchParams.has("status"), false);
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      return Response.json({ workflow_runs: [run()] });
    },
  });
  assert.equal(runs.length, 1);
});

test("API errors fail closed without waiting or accepting old results", async () => {
  await assert.rejects(
    waitForQuality({
      sha,
      listRuns: () =>
        listQualityRuns({
          repository: "owner/repo",
          sha,
          token: "test-only",
          request: async () => new Response(null, { status: 403 }),
        }),
      sleep: async () => assert.fail("must not retry an API error"),
    }),
    /HTTP 403/,
  );
  await assert.rejects(
    listQualityRuns({
      repository: "owner/repo",
      sha,
      token: "test-only",
      request: async () => {
        throw new Error("network failure");
      },
    }),
    /network failure/,
  );
  await assert.rejects(
    listQualityRuns({
      repository: "owner/repo",
      sha,
      token: "test-only",
      request: async () => Response.json({}),
    }),
    /Invalid/,
  );
});

test("manual dispatch and tag pushes both require stable version tags", () => {
  assert.equal(releaseVersion("refs/tags/v1.2.3"), "1.2.3");
  for (const ref of [
    "refs/heads/main",
    "refs/tags/v1.2",
    "refs/tags/v01.2.3",
    "refs/tags/v1.2.3-rc.1",
    "refs/tags/vbad",
  ]) {
    assert.throws(() => releaseVersion(ref), /stable vX.Y.Z tag/);
  }
});
