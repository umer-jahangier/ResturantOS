import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { resolveTenantSlug } from "@/lib/auth/tenant-slug";
import { clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { LoginForm } from "@/components/auth/login-form";

// Capture router.push without a real Next router.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
}));

// Keep toasts inert (no Toaster mounted) while still asserting they fire.
const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
  Toaster: () => null,
}));

function authError(code: string, message: string, status: number) {
  return HttpResponse.json({ error: { code, message, details: [], traceId: "t" } }, { status });
}

function renderLoginForm(tenantSlug: string | null = "acme") {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <LoginForm tenantSlug={tenantSlug} />
    </Wrapper>,
  );
}

describe("resolveTenantSlug", () => {
  it("prefers the ?tenant= search param", () => {
    expect(resolveTenantSlug({ host: "acme.restaurantos.com", searchParam: "beta" })).toBe("beta");
  });

  it("falls back to the leftmost subdomain label", () => {
    expect(resolveTenantSlug({ host: "acme.restaurantos.com" })).toBe("acme");
    expect(resolveTenantSlug({ host: "acme.localhost:3000" })).toBe("acme");
  });

  it("returns null when neither subdomain nor param yields a slug", () => {
    expect(resolveTenantSlug({ host: "restaurantos.com" })).toBeNull();
    expect(resolveTenantSlug({ host: "www.restaurantos.com" })).toBeNull();
    expect(resolveTenantSlug({ host: "localhost" })).toBeNull();
    expect(resolveTenantSlug({})).toBeNull();
  });
});

describe("LoginForm", () => {
  beforeEach(() => {
    pushMock.mockClear();
    toastErrorMock.mockClear();
  });
  afterEach(() => clearSession());

  it("logs in a non-privileged user and redirects to /app/dashboard", async () => {
    const user = userEvent.setup();
    renderLoginForm();

    await user.type(screen.getByLabelText(/email/i), "staff@demo.test");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/dashboard"));
  });

  it("reveals the TOTP field on TOTP_REQUIRED and succeeds on resubmit (FD-2)", async () => {
    const user = userEvent.setup();
    renderLoginForm();

    // owner@demo.test is the seeded privileged user → 401 TOTP_REQUIRED without a code.
    await user.type(screen.getByLabelText(/email/i), "owner@demo.test");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const totpField = await screen.findByLabelText(/authenticator code/i);
    expect(totpField).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();

    await user.type(totpField, "123456");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/dashboard"));
  });

  it("maps UNAUTHENTICATED(401) to a generic message that never leaks tenant status", async () => {
    server.use(
      http.post("*/api/v1/auth/login", () =>
        authError("UNAUTHENTICATED", "Authentication failed", 401),
      ),
    );
    const user = userEvent.setup();
    renderLoginForm();

    await user.type(screen.getByLabelText(/email/i), "staff@demo.test");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(screen.queryByText(/suspend/i)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("maps ACCOUNT_LOCKED(423) to a 'temporarily locked' message", async () => {
    server.use(
      http.post("*/api/v1/auth/login", () => authError("ACCOUNT_LOCKED", "Account locked", 423)),
    );
    const user = userEvent.setup();
    renderLoginForm();

    await user.type(screen.getByLabelText(/email/i), "staff@demo.test");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/temporarily locked/i)).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalled();
  });
});

/**
 * 16a-01 — one form, email-first, for everyone.
 *
 * These render with `tenantSlug={null}`, which is now the ORDINARY case: no subdomain, no
 * `?tenant=`, and nothing rewriting the URL to supply one.
 */
describe("LoginForm — email-first (16a-01)", () => {
  beforeEach(() => {
    pushMock.mockClear();
    toastErrorMock.mockClear();
  });
  afterEach(() => clearSession());

  it("asks for no restaurant and submits without a tenantSlug", async () => {
    let submitted: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/v1/auth/login", async ({ request }) => {
        submitted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            accessToken: "header.payload.",
            expiresInSeconds: 900,
            userId: "11111111-1111-4111-8111-111111111111",
            tenantId: "22222222-2222-4222-8222-222222222222",
            branchId: "33333333-3333-4333-8333-333333333333",
            tokenType: "access",
          },
          meta: null,
          warnings: [],
        });
      }),
    );

    const user = userEvent.setup();
    renderLoginForm(null);

    // The field is absent, not merely optional. Before this plan it was present AND required, and
    // the form refused to submit without it.
    expect(screen.queryByTestId("tenant-slug")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/email/i), "staff@demo.test");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/dashboard"));
    // Omitted entirely rather than sent as "". The server normalises both, but a blank string in
    // the request is a different intent from an absent field and would hide the default in logs.
    expect(submitted).not.toBeNull();
    expect(submitted!).not.toHaveProperty("tenantSlug");
  });

  it("routes a platform token to the platform console, not the tenant app", async () => {
    server.use(
      http.post("*/api/v1/auth/login", () =>
        HttpResponse.json({
          data: {
            accessToken: "header.payload.",
            expiresInSeconds: 900,
            userId: "44444444-4444-4444-8444-444444444444",
            // A platform user belongs to no tenant and no branch — nulls, not empty strings.
            tenantId: null,
            branchId: null,
            tokenType: "platform",
          },
          meta: null,
          warnings: [],
        }),
      ),
    );

    const user = userEvent.setup();
    renderLoginForm(null);

    await user.type(screen.getByLabelText(/email/i), "superadmin@softxlogic.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // The decision comes from the RESPONSE, not from which form was used — there is only one form,
    // and only the server knows the credential turned out to be a control-plane one.
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/platform/dashboard"));
  });

  it("offers a chooser on TENANT_SELECTION_REQUIRED and completes with the picked slug", async () => {
    const slugsSent: (string | undefined)[] = [];
    server.use(
      http.post("*/api/v1/auth/login", async ({ request }) => {
        const body = (await request.json()) as { tenantSlug?: string };
        slugsSent.push(body.tenantSlug);
        if (!body.tenantSlug) {
          // Every entry is a tenant the password ACTUALLY matched — auth-service builds the list
          // after the bcrypt comparison, never before.
          return HttpResponse.json(
            {
              error: {
                code: "TENANT_SELECTION_REQUIRED",
                message: "Select which restaurant to sign in to",
                details: [
                  { field: "acme-grill", issue: "Acme Grill" },
                  { field: "beta-bistro", issue: "Beta Bistro" },
                ],
                traceId: "t",
              },
            },
            { status: 409 },
          );
        }
        return HttpResponse.json({
          data: {
            accessToken: "header.payload.",
            expiresInSeconds: 900,
            userId: "11111111-1111-4111-8111-111111111111",
            tenantId: "22222222-2222-4222-8222-222222222222",
            branchId: "33333333-3333-4333-8333-333333333333",
            tokenType: "access",
          },
          meta: null,
          warnings: [],
        });
      }),
    );

    const user = userEvent.setup();
    renderLoginForm(null);

    await user.type(screen.getByLabelText(/email/i), "consultant@two-groups.test");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByTestId("tenant-chooser")).toBeInTheDocument();
    expect(screen.getByTestId("tenant-choice-acme-grill")).toHaveTextContent("Acme Grill");
    expect(screen.getByTestId("tenant-choice-beta-bistro")).toHaveTextContent("Beta Bistro");
    // A question, not a session.
    expect(pushMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("tenant-choice-beta-bistro"));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/dashboard"));
    // Exactly two requests: the resolution attempt and the chosen one. No speculative logins —
    // the gateway rate-limits this route at 2/s.
    expect(slugsSent).toEqual([undefined, "beta-bistro"]);
  });

  /**
   * F12 — the forced change happens IN PLACE, and the single-use token never enters a URL.
   *
   * The old behaviour was `router.push("/login/change-password?token=…&email=…")`. That put a live
   * single-use credential and the user's address into browser history, into the `Referer` of every
   * subsequent request from that page, and into every proxy and gateway access log on the way. The
   * walkthrough caught a new hire meeting it on their first minute in the product.
   *
   * This asserts the user-visible consequence, not the component's props: the change form appears
   * without a navigation, the token still reaches the endpoint that needs it, and the flow finishes.
   */
  it("changes a forced password in place, never putting the token or email in a URL", async () => {
    const forcedBodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/api/v1/auth/login", () =>
        HttpResponse.json(
          {
            error: {
              code: "PASSWORD_CHANGE_REQUIRED",
              message: "Password change required",
              details: [
                { field: "changeToken", issue: "tok-123" },
                { field: "expiresAt", issue: "2026-01-01T00:00:00Z" },
              ],
              traceId: "t",
            },
          },
          { status: 403 },
        ),
      ),
      http.post("*/api/v1/auth/change-password/forced", async ({ request }) => {
        forcedBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ data: null });
      }),
    );

    const user = userEvent.setup();
    renderLoginForm(null);

    await user.type(screen.getByLabelText(/email/i), "fresh@demo.test");
    await user.type(screen.getByLabelText(/^password$/i), "temp-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // 403, not 401, precisely so the client does NOT re-prompt for the password in a loop.
    // The screen it needs is now rendered here rather than at another URL.
    expect(await screen.findByTestId("forced-password-change")).toBeInTheDocument();
    expect(screen.getByText(/fresh@demo\.test/)).toBeInTheDocument();

    // The whole point: NOTHING navigated. No history entry, no Referer, no proxy log line.
    expect(pushMock).not.toHaveBeenCalled();

    // The password that just verified is carried in memory, so a new hire does not retype the
    // one-time password they were handed. It is a real, editable field — not a hidden input.
    const current = screen.getByLabelText(/current password/i);
    expect(current).toHaveValue("temp-password");

    await user.type(screen.getByLabelText(/^new password$/i), "Chosen#Password1");
    await user.type(screen.getByLabelText(/confirm new password/i), "Chosen#Password1");
    await user.click(screen.getByRole("button", { name: /^change password$/i }));

    // The single-use token still reaches the endpoint that spends it — it was never needed in a URL.
    await waitFor(() => expect(forcedBodies).toHaveLength(1));
    expect(forcedBodies[0]).toMatchObject({
      changeToken: "tok-123",
      currentPassword: "temp-password",
      newPassword: "Chosen#Password1",
    });

    // Back on the credential form, with the address kept — it was in memory, not in the query
    // string, so there is nothing to read it back out of.
    expect(await screen.findByText(/sign in with your new password/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toHaveValue("fresh@demo.test"));
    expect(pushMock).not.toHaveBeenCalled();
  });

  /**
   * F12 — a 401 from the PUBLIC forced-change endpoint is a wrong credential, not a dead session.
   *
   * The api-client's 401 interceptor only exempted `/login` and `/refresh`, so a new hire who
   * mistyped their one-time password had the client attempt a token refresh on their behalf and
   * then hard-navigate to `/login?reason=session_expired` — telling them a session they never had
   * had ended, and destroying the in-memory change token in the process. The panel's own refusal
   * message existed in the source the whole time and had never been rendered.
   *
   * `window.location` cannot be navigated in jsdom, so the assertion is on the MECHANISM that
   * precedes it and is observable: no refresh is attempted, and the panel stays up with the error.
   */
  it("treats a 401 from the public change endpoint as a bad credential, not an expired session", async () => {
    let refreshCalls = 0;
    server.use(
      http.post("*/api/v1/auth/login", () =>
        HttpResponse.json(
          {
            error: {
              code: "PASSWORD_CHANGE_REQUIRED",
              message: "Password change required",
              details: [{ field: "changeToken", issue: "tok-123" }],
              traceId: "t",
            },
          },
          { status: 403 },
        ),
      ),
      http.post("*/api/v1/auth/refresh", () => {
        refreshCalls += 1;
        return authError("UNAUTHENTICATED", "Authentication failed", 401);
      }),
      http.post("*/api/v1/auth/change-password/forced", () =>
        authError("UNAUTHENTICATED", "Invalid credentials", 401),
      ),
    );

    const user = userEvent.setup();
    renderLoginForm(null);

    await user.type(screen.getByLabelText(/email/i), "fresh@demo.test");
    await user.type(screen.getByLabelText(/^password$/i), "wrong-temp-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await screen.findByTestId("forced-password-change");
    await user.type(screen.getByLabelText(/^new password$/i), "Chosen#Password1");
    await user.type(screen.getByLabelText(/confirm new password/i), "Chosen#Password1");
    await user.click(screen.getByRole("button", { name: /^change password$/i }));

    // The panel says what actually happened, and is still there to be corrected.
    expect(await screen.findByText(/expired or the current password is wrong/i)).toBeInTheDocument();
    expect(screen.getByTestId("forced-password-change")).toBeInTheDocument();

    // No refresh was attempted. A refresh here is the first step of the false "session expired"
    // bounce — there is no session to refresh, because this endpoint is reached without one.
    expect(refreshCalls).toBe(0);
  });

  it("still honours a tenant hint, prefilled and clearable rather than imposed", async () => {
    const user = userEvent.setup();
    renderLoginForm("acme");

    // Shown BECAUSE a hint filled it — so the user can see (and delete) what the URL chose for
    // them. That is the difference between a hint and the forced redirect this plan removed.
    const field = await screen.findByTestId("tenant-slug");
    expect(field).toHaveValue("acme");

    await user.clear(field);
    expect(field).toHaveValue("");
  });
});
