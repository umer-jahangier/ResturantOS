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
  return HttpResponse.json(
    { error: { code, message, details: [], traceId: "t" } },
    { status },
  );
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
    expect(
      resolveTenantSlug({ host: "acme.restaurantos.com", searchParam: "beta" }),
    ).toBe("beta");
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
      http.post("*/api/v1/auth/login", () =>
        authError("ACCOUNT_LOCKED", "Account locked", 423),
      ),
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
