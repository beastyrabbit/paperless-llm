import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootPackage = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../package.json"), "utf8"),
) as {
  scripts: Record<string, string>;
};

describe("local web runtime configuration", () => {
  it.each(["dev:web", "dev:web:portless"])(
    "starts %s under the same Infisical dev environment as the backend",
    (scriptName) => {
      const script = rootPackage.scripts[scriptName];

      expect(script).toContain("infisical run");
      expect(script).toContain("--projectId=d67f0b05-1b14-4374-b788-be3806466514");
      expect(script).toContain("--env=dev");
      expect(script).toContain("--path=/");
    },
  );

  it("requires the shared backend proxy token before starting the dev stack", () => {
    expect(rootPackage.scripts["env:check"]).toContain("PAPERLESS_LLM_API_TOKEN");
  });
});
