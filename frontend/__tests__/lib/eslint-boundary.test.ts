import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

// Frontend package root (this file is at <root>/__tests__/lib/).
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function createLinter(): ESLint {
  return new ESLint({
    cwd: rootDir,
    overrideConfigFile: path.join(rootDir, "eslint.config.mjs"),
  });
}

describe("ESLint layer-boundary (FE-08)", () => {
  it("flags a component importing a repository directly", async () => {
    const eslint = createLinter();
    const [result] = await eslint.lintText(
      `import { SessionRepository } from "@/lib/repositories/session.repository";\n` +
        `export function Widget() {\n  void SessionRepository;\n  return null;\n}\n`,
      { filePath: path.join(rootDir, "components", "widget.tsx") },
    );

    const ruleIds = (result?.messages ?? []).map((message) => message.ruleId);
    expect(ruleIds).toContain("no-restricted-imports");
  });

  it("allows a component importing a Layer-3 hook", async () => {
    const eslint = createLinter();
    const [result] = await eslint.lintText(
      `import { useLogin } from "@/lib/hooks/auth/use-login";\n` +
        `export function Widget() {\n  void useLogin;\n  return null;\n}\n`,
      { filePath: path.join(rootDir, "components", "ok-widget.tsx") },
    );

    const ruleIds = (result?.messages ?? []).map((message) => message.ruleId);
    expect(ruleIds).not.toContain("no-restricted-imports");
  });
});
