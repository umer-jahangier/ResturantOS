import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { apiAiSettingsSchema } from "@/lib/api-client/schemas/ai-settings.schema";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

/**
 * Settings → AI (Program C): the screen never shows the key, and it tells the truth about state.
 *
 * <h2>Written against this repo's absence-assertion trap</h2>
 *
 * <p>`await waitFor(() => expect(queryByRole(...)).not.toBeInTheDocument())` returns on the FIRST
 * frame and passes even with the guard deleted — nothing has rendered yet, so nothing is absent.
 * Every "the key is not shown" assertion below therefore waits FOR a positive element first
 * (`await screen.findByTestId("ai-key-hint")`), and only then, in that settled frame, asserts the
 * key is absent. Delete the guard and the positive `findBy*` still resolves, so the absence
 * assertion is genuinely reached.
 */

const TENANT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";

/**
 * A syntactically plausible but ENTIRELY FAKE key. It exists in this file only as a string to
 * assert the absence of. No real credential is used or needed anywhere in these tests.
 */
const FAKE_KEY = "sk-ant-TEST-not-a-real-key-000000004242";

function settings(over: Record<string, unknown> = {}) {
  return {
    provider: "ANTHROPIC",
    source: "TENANT",
    keyLast4: "4242",
    keyState: "VERIFIED",
    lastVerifiedAt: "2026-08-12T10:00:00Z",
    lastRejectedAt: null,
    updatedAt: "2026-08-12T10:00:00Z",
    updatedBy: "6b1f4d2e-0000-4000-8000-000000000001",
    canManage: true,
    storageAvailable: true,
    ...over,
  };
}

function mockGet(body: Record<string, unknown>) {
  server.use(
    http.get("*/api/v1/nlq/settings/ai", () => HttpResponse.json({ success: true, data: body })),
  );
}

afterEach(() => clearSession());

describe("Settings → AI", () => {
  it("shows the masked hint and NEVER the key itself", async () => {
    seedSession({ tenantId: TENANT, permissions: ["nlq.settings.manage"] });
    mockGet(settings());

    render(<AiSettingsForm />, { wrapper: createQueryWrapper() });

    // POSITIVE CONTROL FIRST. Wait FOR the hint. This is what makes the absence assertions below
    // real — the frame has settled and the component has rendered its credential section.
    const hint = await screen.findByTestId("ai-key-hint");
    expect(hint).toHaveTextContent("•••• 4242");

    // The key must not be rendered as visible text anywhere on the page.
    expect(document.body.textContent).not.toContain(FAKE_KEY);

    // ...and not as a form VALUE either. This needs the key-entry form to actually be on screen:
    // in the VERIFIED/TENANT state the component shows "Replace key" and mounts no input at all,
    // so asserting queryByDisplayValue here without opening it passes vacuously — measured, when a
    // deliberate prefill of the field failed only the next test and not this one. Wait FOR the
    // input, THEN assert the key is not in it.
    await userEvent.click(await screen.findByRole("button", { name: /replace key/i }));
    const input = await screen.findByLabelText(/anthropic api key/i);
    expect(input).not.toHaveValue(FAKE_KEY);
    expect(screen.queryByDisplayValue(FAKE_KEY)).toBeNull();
  });

  it("never seeds the input from the server — the field starts empty even with a key on file", async () => {
    seedSession({ tenantId: TENANT, permissions: ["nlq.settings.manage"] });
    mockGet(settings());

    render(<AiSettingsForm />, { wrapper: createQueryWrapper() });

    // Settled frame first.
    await screen.findByTestId("ai-key-hint");
    await userEvent.click(await screen.findByRole("button", { name: /replace key/i }));

    const input = await screen.findByLabelText(/anthropic api key/i);
    expect(input).toHaveValue("");
    // The one control that could ever display a credential is a password field.
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
  });

  it("renders REJECTED as actionable, not as 'try again later'", async () => {
    seedSession({ tenantId: TENANT, permissions: ["nlq.settings.manage"] });
    mockGet(settings({ keyState: "REJECTED", lastRejectedAt: "2026-08-12T11:00:00Z" }));

    render(<AiSettingsForm />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/refused this key/i)).toBeInTheDocument();
    // The whole point of the distinct server code: an owner must be told to replace it, not wait.
    expect(await screen.findByText(/replace it below/i)).toBeInTheDocument();
  });

  it("renders UNVERIFIED as a caution, not a failure", async () => {
    seedSession({ tenantId: TENANT, permissions: ["nlq.settings.manage"] });
    mockGet(settings({ keyState: "UNVERIFIED", lastVerifiedAt: null }));

    render(<AiSettingsForm />, { wrapper: createQueryWrapper() });

    // UNVERIFIED means the provider was unreachable at save time — not that the key is bad. It
    // self-heals on the first successful question, and saying otherwise would send an owner to
    // re-enter a key that is probably fine.
    expect(await screen.findByText(/not yet verified/i)).toBeInTheDocument();
    expect(await screen.findByText(/confirmed automatically/i)).toBeInTheDocument();
  });

  it("a tenant on the platform key is offered the form, not an empty state", async () => {
    seedSession({ tenantId: TENANT, permissions: ["nlq.settings.manage"] });
    mockGet(settings({ source: "PLATFORM", keyLast4: null, keyState: "UNSET" }));

    render(<AiSettingsForm />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/using the built-in ai key/i)).toBeInTheDocument();
    // No row is a real configuration, not an absence to explain.
    expect(await screen.findByLabelText(/anthropic api key/i)).toBeInTheDocument();
  });

  it("explains an unconfigured server instead of showing a form that always fails", async () => {
    seedSession({ tenantId: TENANT, permissions: ["nlq.settings.manage"] });
    mockGet(settings({ storageAvailable: false }));

    render(<AiSettingsForm />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/secure storage is not configured/i)).toBeInTheDocument();
  });
});

describe("the AI settings response schema", () => {
  it("ACCEPTS the documented shape — the positive control", () => {
    expect(() => apiAiSettingsSchema.parse(settings())).not.toThrow();
  });

  it("THROWS if the server ever starts echoing the key back", () => {
    // The server structurally cannot do this: AiSettingsView has no key component. `.strict()` is
    // the second, independent guard — it turns a server-side regression into a loud client failure
    // instead of a silent credential handed into the render tree, React DevTools, and any error
    // reporter. Drop `.strict()` from the schema and this test fails.
    expect(() => apiAiSettingsSchema.parse({ ...settings(), apiKey: FAKE_KEY })).toThrow();
  });

  it("THROWS on any unexpected field, not just one named apiKey", () => {
    // The guard must not depend on guessing the leaking field's name.
    expect(() => apiAiSettingsSchema.parse({ ...settings(), secretValue: FAKE_KEY })).toThrow();
  });
});
