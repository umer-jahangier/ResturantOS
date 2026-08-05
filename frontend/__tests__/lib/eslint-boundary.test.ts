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

/**
 * Loading the real eslint.config.mjs costs whole seconds, and the cost grows with the project —
 * these two cases sat at ~4.9s against vitest's 5s default, so adding a handful of source files
 * was enough to time the first one out. That reads as "the layer boundary broke" when nothing
 * about the boundary changed. These assert lint BEHAVIOUR, never lint speed; the budget is
 * explicit and generous so it stays that way.
 */
const LINT_TIMEOUT_MS = 30_000;

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
  }, LINT_TIMEOUT_MS);

  it("allows a component importing a Layer-3 hook", async () => {
    const eslint = createLinter();
    const [result] = await eslint.lintText(
      `import { useLogin } from "@/lib/hooks/auth/use-login";\n` +
        `export function Widget() {\n  void useLogin;\n  return null;\n}\n`,
      { filePath: path.join(rootDir, "components", "ok-widget.tsx") },
    );

    const ruleIds = (result?.messages ?? []).map((message) => message.ruleId);
    expect(ruleIds).not.toContain("no-restricted-imports");
  }, LINT_TIMEOUT_MS);
});
