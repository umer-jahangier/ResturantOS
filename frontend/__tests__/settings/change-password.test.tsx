import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/server";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { ChangePasswordForm } from "@/components/settings/change-password-form";

// The success branch offers a "Sign in again" button backed by `useLogout`, which calls
// `useRouter` — unmounted outside a Next app router. Same stub the login-form tests use.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * The refusal wording is the whole of this file.
 *
 * <p>A signed-in user who mistypes their current password was told <b>"Please sign in again."</b> —
 * the shared `UNAUTHENTICATED` copy, correct nearly everywhere and wrong here, where the same code
 * means "that password is not right". It sent people to do the one thing that could not help.
 * Observed in a real browser before it was fixed; frozen here so it cannot come back through an
 * innocent-looking edit to the shared error map.
 */

function renderForm() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <ChangePasswordForm />
    </Wrapper>,
  );
}

async function submit(current: string, next: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Repeat new password"), next);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

afterEach(() => {
  cleanup();
  clearSession();
});

describe("self-service password change reports the refusal it actually got", () => {
  it("says the CURRENT PASSWORD is wrong on a 401 — not 'sign in again'", async () => {
    server.use(
      http.post("*/api/v1/auth/change-password", () =>
        HttpResponse.json(
          {
            error: {
              code: "UNAUTHENTICATED",
              message: "Authentication failed",
              details: [],
              traceId: "t",
            },
          },
          { status: 401 },
        ),
      ),
    );
    seedSession({ roles: ["MANAGER"], permissions: [] });

    renderForm();
    await submit("WrongCurrent!1", "BrandNewPass!9");

    const message = await screen.findByTestId("change-password-error");
    expect(message).toHaveTextContent(/current password is not right/i);
    // The control: the sentence that used to appear must not.
    expect(message).not.toHaveTextContent(/sign in again/i);
  });

  it("names password reuse as reuse, because 'try again' is useless advice for it", async () => {
    server.use(
      http.post("*/api/v1/auth/change-password", () =>
        HttpResponse.json(
          {
            error: {
              code: "PASSWORD_REUSE",
              message: "Password was used previously",
              details: [],
              traceId: "t",
            },
          },
          { status: 400 },
        ),
      ),
    );
    seedSession({ roles: ["MANAGER"], permissions: [] });

    renderForm();
    await submit("RightCurrent!1", "BrandNewPass!9");

    expect(await screen.findByTestId("change-password-error")).toHaveTextContent(
      /used here before/i,
    );
  });

  it("on success it says every session ended, including this one", async () => {
    server.use(
      http.post("*/api/v1/auth/change-password", () =>
        HttpResponse.json({ data: null, meta: null, warnings: [] }),
      ),
    );
    seedSession({ roles: ["MANAGER"], permissions: [] });

    renderForm();
    await submit("RightCurrent!1", "BrandNewPass!9");

    // The server revokes EVERY refresh session including the caller's, so a form that said
    // "saved" and left the user sitting there would be setting up a logout with no cause.
    expect(await screen.findByText(/Every signed-in session was ended/i)).toBeInTheDocument();
  });

  it("refuses a weak new password without asking the server", async () => {
    seedSession({ roles: ["MANAGER"], permissions: [] });
    renderForm();
    await submit("RightCurrent!1", "alllowercase");

    // auth-service's `@StrongPassword` would refuse this too; mirroring it turns a round trip
    // into an inline message rather than replacing the server's rule.
    expect(await screen.findByText("Include an uppercase letter")).toBeInTheDocument();
  });
});
