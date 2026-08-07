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

  it("sends the user to the forced-change screen on 403 PASSWORD_CHANGE_REQUIRED", async () => {
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
    );

    const user = userEvent.setup();
    renderLoginForm(null);

    await user.type(screen.getByLabelText(/email/i), "fresh@demo.test");
    await user.type(screen.getByLabelText(/password/i), "temp-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // 403, not 401, precisely so the client does NOT re-prompt for the password in a loop. Before
    // this plan there was no screen at this destination at all and every provisioned account —
    // including the first admin of every new tenant — dead-ended here.
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("/login/change-password")),
    );
    // The change token has to survive the redirect — it is single-use, minted by the refusal, and
    // the screen cannot succeed without it.
    expect(String(pushMock.mock.calls[0]?.[0])).toContain("token=tok-123");
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
