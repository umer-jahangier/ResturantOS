import { describe, expect, it } from "vitest";

import { buildStepUpLoginHref, sanitizeReturnPath } from "@/lib/auth/step-up";

describe("sanitizeReturnPath", () => {
  it("keeps a same-origin absolute path", () => {
    expect(sanitizeReturnPath("/app/hr/payroll")).toBe("/app/hr/payroll");
    expect(sanitizeReturnPath("/app/finance/periods?fy=2026")).toBe("/app/finance/periods?fy=2026");
  });

  it("returns null when there is nothing to go back to", () => {
    expect(sanitizeReturnPath(null)).toBeNull();
    expect(sanitizeReturnPath(undefined)).toBeNull();
    expect(sanitizeReturnPath("")).toBeNull();
  });

  // The whole reason this function exists. `next` arrives in the URL, so these are the values an
  // attacker actually gets to choose — and a redirect that fires immediately after a real login on
  // the real domain is about the most convincing phishing hop there is.
  it.each([
    ["absolute http url", "https://evil.example/pay"],
    ["protocol-relative", "//evil.example/pay"],
    ["backslash-relative", "/\\evil.example/pay"],
    ["scheme buried mid-string", "/app/x?u=javascript://evil.example"],
    ["relative path", "app/hr/payroll"],
    ["newline injection", "/app/hr\nLocation: https://evil.example"],
  ])("rejects %s", (_label, candidate) => {
    expect(sanitizeReturnPath(candidate)).toBeNull();
  });
});

describe("buildStepUpLoginHref", () => {
  it("carries the reason and the return path", () => {
    const href = buildStepUpLoginHref("/app/hr/payroll");
    const params = new URLSearchParams(href.slice(href.indexOf("?")));

    expect(href.startsWith("/login?")).toBe(true);
    expect(params.get("reason")).toBe("step_up_required");
    expect(params.get("next")).toBe("/app/hr/payroll");
  });

  it("omits `next` entirely rather than passing an unsafe one through", () => {
    expect(buildStepUpLoginHref("https://evil.example")).toBe("/login?reason=step_up_required");
    expect(buildStepUpLoginHref(null)).toBe("/login?reason=step_up_required");
  });
});
