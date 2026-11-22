import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";

// Exercise the built CLI and assets through real loopback HTTP. No provider is reachable.
const directory = await mkdtemp(join(tmpdir(), "paperless-artifact-"));
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const config = parse(await readFile("config.example.yaml", "utf8"));
config.server = { port, host: "127.0.0.1" };
config.paperless.url = "http://127.0.0.1:1";
config.ocr.enabled = false;
config.polling.enabled = false;
const configPath = join(directory, "config.yaml");
await writeFile(configPath, stringify(config));
const processUnderTest = spawn(process.execPath, ["dist/cli.js", "serve"], {
  env: { ...process.env, PAPERLESS_LLM_CONFIG: configPath,
    PAPERLESS_LLM_DB: join(directory, "state.db"), PAPERLESS_TOKEN: "artifact-fixture",
    MISTRAL_API_KEY: "", JEV_API_KEY: "", LLM_API_KEY: "", LOCAL_LLM_API_KEY: "",
    APP_VERSION: "1.2.3", APP_REVISION: "a".repeat(40) },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
processUnderTest.stdout.on("data", (chunk) => { output += chunk; });
processUnderTest.stderr.on("data", (chunk) => { output += chunk; });
const exit = once(processUnderTest, "exit");
try {
  const base = "http://127.0.0.1:" + port;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(base + "/health")).ok; } catch { /* starting */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(ready, "Built CLI did not become healthy");
  for (const path of ["/", "/consolidation", "/activity", "/config", "/privacy", "/datenschutz", "/impressum", "/legal-notice"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /<html/);
  }
  for (const path of ["/version", "/api/version"]) assert.deepEqual(await (await fetch(base + path)).json(), {
    version: "1.2.3", revision: "a".repeat(40),
  });
  assert.equal((await fetch(base + "/assets/styles.css")).status, 200);
  assert.equal((await fetch(base + "/actions/consolidation/scan", { method: "POST", headers: { Origin: "https://elsewhere.test" } })).status, 403);
} finally {
  processUnderTest.kill("SIGTERM");
  const timeout = setTimeout(() => processUnderTest.kill("SIGKILL"), 5000);
  const [code, signal] = await exit;
  clearTimeout(timeout);
  assert.equal(signal, null, "Built CLI did not shut down gracefully");
  assert.equal(code, 0, "Built CLI exited unsuccessfully");
}
assert.equal(output, "", "Built CLI emitted warnings or errors");
console.log("Built CLI, migrations, all pages, assets, CSRF and SIGTERM passed.");
