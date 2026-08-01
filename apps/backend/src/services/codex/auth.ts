import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CodexRuntimeError } from "./errors.js";

const authFileNames = ["auth.json"] as const;

export const defaultCodexHome = (): string =>
  process.env["CODEX_HOME"] ?? path.join(process.env["HOME"] ?? process.cwd(), ".codex");

export const copyCodexAuthOnly = async (
  sourceCodexHome: string,
  targetCodexHome: string,
): Promise<readonly string[]> => {
  const copied: string[] = [];
  for (const fileName of authFileNames) {
    const source = path.join(sourceCodexHome, fileName);
    const target = path.join(targetCodexHome, fileName);
    try {
      const stat = await fs.stat(source);
      if (!stat.isFile() || stat.size === 0) continue;
      await fs.copyFile(source, target);
      await fs.chmod(target, 0o600);
      copied.push(fileName);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") continue;
      throw new CodexRuntimeError({
        code: "CODEX_AUTH_COPY_FAILED",
        message: "Failed to copy Codex auth material into isolated runtime home.",
        cause: error,
      });
    }
  }

  if (copied.length === 0) {
    throw new CodexRuntimeError({
      code: "CODEX_AUTH_MISSING",
      message: "Codex auth is unavailable. Run `codex login` before using the Codex runtime.",
      details: { checkedFileNames: authFileNames },
    });
  }

  return copied;
};
