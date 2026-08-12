import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F12 — `/login/change-password` must never again read a credential out of the query string.
 *
 * The route used to be the forced-change screen, and the only way to get the single-use change
 * token to it was `?token=…&email=…`. That URL landed in browser history, in the `Referer` header
 * of the next request, and in every proxy access log between the browser and the gateway.
 *
 * The change now happens inside the login form with the token held in memory, so this route exists
 * only to send stale links somewhere useful. Two things are asserted, because a page that quietly
 * regrew a `searchParams` argument would look identical from the outside until someone read it:
 *
 *  1. it redirects, unconditionally, to a URL carrying no query string at all;
 *  2. the page component accepts NO arguments — `page.length === 0` — so it cannot be reading
 *     `searchParams`, which is the only channel the leak ever travelled on.
 */

const { redirectMock } = vi.hoisted(() => ({
  // The destination is folded into the thrown message as well as recorded in `mock.calls`, so the
  // assertion below cannot pass against a mock that was never given one.
  redirectMock: vi.fn((url: string): never => {
    // Next's real `redirect` throws to unwind the render; mirror that so callers behave the same.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import ForcedPasswordChangePage from "@/app/(auth)/login/change-password/page";

describe("/login/change-password", () => {
  // Block body, not a concise arrow: `mockClear()` returns the mock, and Vitest treats a function
  // returned from `beforeEach` as the per-test teardown — so the concise form quietly CALLS
  // `redirect()` after every test in this file.
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("redirects to a token-free /login and forwards no query string", () => {
    expect(() => ForcedPasswordChangePage()).toThrow("NEXT_REDIRECT:/login");

    expect(redirectMock).toHaveBeenCalledTimes(1);
    const [target] = redirectMock.mock.calls[0] ?? [""];
    expect(target).toBe("/login");
    expect(target).not.toContain("?");
    expect(target).not.toMatch(/token|email/i);
  });

  it("takes no props, so it cannot read ?token= or ?email= even by accident", () => {
    expect(ForcedPasswordChangePage.length).toBe(0);
  });
});
