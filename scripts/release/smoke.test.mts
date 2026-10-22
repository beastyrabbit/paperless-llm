import assert from "node:assert/strict";
import { test } from "node:test";
import { pollDeployment, type Version } from "./smoke.mts";

const expected = { version: "1.2.3", revision: "a".repeat(40) };
const stale = { version: "1.2.2", revision: "b".repeat(40) };
const newer = { version: "1.10.0", revision: "c".repeat(40) };

function smoke(snapshots: [Version | number, Version | number][], pageStatus = 200) {
  let time = 0;
  let sample = 0;
  const paths: string[] = [];
  const result = pollDeployment({
    baseUrl: "http://service:3765",
    expected,
    timeoutMs: 30,
    intervalMs: 10,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
      sample++;
    },
    log: () => {},
    request: async (input, init) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      assert.equal(init?.method, "GET");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal);
      assert.deepEqual(init.headers, { "Cache-Control": "no-cache, no-store" });
      if (path === "/" || path === "/privacy") {
        return new Response("<!doctype html><html><body>Privacy</body></html>", {
          status: path === "/" ? 200 : pageStatus,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      assert.ok(path === "/version" || path === "/api/version");
      const snapshot = snapshots[Math.min(sample, snapshots.length - 1)];
      const version = snapshot?.[path === "/version" ? 0 : 1];
      return typeof version === "number"
        ? new Response(null, { status: version })
        : Response.json(version);
    },
  });
  return { result, paths };
}

test("checks reachability, waits through stale and mixed images, then checks one page", async () => {
  const check = smoke([
    [stale, stale],
    [expected, stale],
    [expected, expected],
  ]);
  assert.equal(await check.result, "deployed");
  assert.equal(check.paths[0], "/");
  assert.equal(check.paths.filter((path) => path === "/version").length, 3);
  assert.equal(check.paths.at(-1), "/privacy");
  assert.equal(check.paths.filter((path) => path === "/privacy").length, 1);
});

test("does not accept matching versions from the wrong commit", async () => {
  await assert.rejects(
    smoke([[expected, { ...expected, revision: stale.revision }]]).result,
    /Timed out/,
  );
});

test("stale images time out without checking the page", async () => {
  const check = smoke([[stale, stale]]);
  await assert.rejects(check.result, /Timed out/);
  assert.equal(check.paths.includes("/privacy"), false);
});

test("mixed images time out", async () => {
  await assert.rejects(smoke([[expected, stale]]).result, /Timed out/);
});

for (const snapshot of [
  [newer, stale],
  [expected, newer],
] as [Version, Version][]) {
  test(`a newer ${snapshot[0] === newer ? "frontend" : "backend"} means superseded`, async () => {
    const check = smoke([snapshot]);
    assert.equal(await check.result, "superseded");
    assert.equal(check.paths.includes("/privacy"), false);
  });
}

test("a missing version endpoint during rollout can recover", async () => {
  assert.equal(
    await smoke([
      [404, 404],
      [expected, expected],
    ]).result,
    "deployed",
  );
});

test("a newer version supersedes even while the other image is unavailable", async () => {
  assert.equal(await smoke([[503, newer]]).result, "superseded");
});

test("HTTP errors time out rather than accepting incomplete metadata", async () => {
  await assert.rejects(smoke([[expected, 503]]).result, /Timed out/);
});

test("invalid version JSON times out", async () => {
  let time = 0;
  await assert.rejects(
    pollDeployment({
      baseUrl: "http://service",
      expected,
      timeoutMs: 1,
      now: () => time,
      sleep: async () => {
        time++;
      },
      log: () => {},
      request: async () => Response.json({ version: expected.version }),
    }),
    /Timed out/,
  );
});

test("page failure fails the smoke check", async () => {
  await assert.rejects(smoke([[expected, expected]], 500).result, /privacy: HTTP 500/);
});

test("unreachable Service fails before polling", async () => {
  let calls = 0;
  await assert.rejects(
    pollDeployment({
      baseUrl: "http://service",
      expected,
      request: async () => {
        calls++;
        throw new Error("unreachable");
      },
    }),
    /unreachable/,
  );
  assert.equal(calls, 1);
});
