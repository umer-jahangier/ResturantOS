import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { SessionRepository } from "@/lib/repositories/session.repository";
import type { LoginBody } from "@/lib/models/auth.model";

const validBody: LoginBody = {
  email: "user@demo.test",
  password: "correct-horse",
  tenantSlug: "demo",
};

describe("SessionRepository (Zod parse-before-adapt contract)", () => {
  it("login() returns a camelCase Session (request → .parse() → adapt)", async () => {
    const session = await SessionRepository.login(validBody);

    expect(typeof session.accessToken).toBe("string");
    expect(session.expiresAt).toBeInstanceOf(Date);
    expect(session.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof session.tenantId).toBe("string");
    expect(typeof session.branchId).toBe("string");
  });

  it("refresh() rebuilds the Session from the new token's JWT claims", async () => {
    const session = await SessionRepository.refresh();

    expect(typeof session.accessToken).toBe("string");
    expect(session.expiresAt).toBeInstanceOf(Date);
    // ids come from decoding the returned JWT (bare token response omits them).
    expect(session.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.tenantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("switchBranch() returns a Session for the new branch", async () => {
    const session = await SessionRepository.switchBranch("44444444-4444-4444-8444-444444444444");

    expect(typeof session.accessToken).toBe("string");
    expect(session.branchId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("logout() resolves without throwing", async () => {
    await expect(SessionRepository.logout()).resolves.toBeUndefined();
  });

  it("login() throws when the API response drifts (missing accessToken)", async () => {
    server.use(
      http.post("*/api/v1/auth/login", () =>
        HttpResponse.json({
          // accessToken intentionally absent → Zod .parse() must throw.
          data: {
            expiresInSeconds: 900,
            userId: "11111111-1111-4111-8111-111111111111",
            tenantId: "22222222-2222-4222-8222-222222222222",
            branchId: "33333333-3333-4333-8333-333333333333",
          },
          meta: null,
          warnings: [],
        }),
      ),
    );

    await expect(SessionRepository.login(validBody)).rejects.toThrowError();
  });
});

/**
 * The 2FA management surface added with the recovery-code module.
 *
 * These assert the parse-before-return contract on each new method, and in particular that
 * `totpBootstrapVerify` — which used to resolve with nothing — now surfaces the recovery codes.
 * That method is the one place in the product where a discarded response destroys a credential the
 * server cannot reissue, so "did it come back at all" is worth pinning in a test.
 */
describe("SessionRepository — two-factor management", () => {
  const CODES = ["ABCDE-FGHJK", "LMNPQ-RSTUV", "WXYZ2-34567"];

  function okCodes() {
    return HttpResponse.json({ data: { recoveryCodes: CODES }, meta: null, warnings: [] });
  }

  it("totpBootstrapVerify() returns the recovery codes rather than discarding them", async () => {
    server.use(http.post("*/api/v1/auth/2fa/bootstrap/verify", okCodes));

    const result = await SessionRepository.totpBootstrapVerify({
      email: "owner@demo.test",
      password: "correct-horse",
      tenantSlug: "demo",
      code: "123456",
    });

    expect(result.recoveryCodes).toEqual(CODES);
  });

  it("totpVerify() returns the recovery codes issued on activation", async () => {
    server.use(http.post("*/api/v1/auth/2fa/verify", okCodes));
    await expect(SessionRepository.totpVerify("123456")).resolves.toEqual({
      recoveryCodes: CODES,
    });
  });

  it("totpRegenerateRecoveryCodes() returns the replacement set", async () => {
    server.use(http.post("*/api/v1/auth/2fa/recovery-codes", okCodes));
    await expect(SessionRepository.totpRegenerateRecoveryCodes("123456")).resolves.toEqual({
      recoveryCodes: CODES,
    });
  });

  it("totpSetup() returns the provisioning URI the QR is drawn from", async () => {
    server.use(
      http.post("*/api/v1/auth/2fa/setup", () =>
        HttpResponse.json({
          data: { otpauthUri: "otpauth://totp/RestaurantOS:a@b.test?secret=ABC&issuer=RestaurantOS" },
          meta: null,
          warnings: [],
        }),
      ),
    );

    const setup = await SessionRepository.totpSetup();
    expect(setup.otpauthUri).toContain("otpauth://totp/");
    expect(new URL(setup.otpauthUri).searchParams.get("secret")).toBe("ABC");
  });

  it("totpStatus() reports enrolment and the remaining recovery-code count", async () => {
    server.use(
      http.get("*/api/v1/auth/2fa/status", () =>
        HttpResponse.json({
          data: { enabled: true, recoveryCodesRemaining: 7 },
          meta: null,
          warnings: [],
        }),
      ),
    );

    await expect(SessionRepository.totpStatus()).resolves.toEqual({
      enabled: true,
      recoveryCodesRemaining: 7,
    });
  });

  it("totpDisable() resolves for an authenticator code and for a recovery code alike", async () => {
    const seen: string[] = [];
    server.use(
      http.post("*/api/v1/auth/2fa/disable", async ({ request }) => {
        seen.push(((await request.json()) as { code: string }).code);
        return HttpResponse.json({ data: null, meta: null, warnings: [] });
      }),
    );

    await SessionRepository.totpDisable("123456");
    await SessionRepository.totpDisable("ABCDE-FGHJK");

    // Both shapes are forwarded untouched — the server decides which check to run, and a client
    // that stripped or reformatted either would break the lost-phone path it exists to serve.
    expect(seen).toEqual(["123456", "ABCDE-FGHJK"]);
  });

  it("an empty recoveryCodes array is a contract break, not an empty state", async () => {
    server.use(
      http.post("*/api/v1/auth/2fa/verify", () =>
        HttpResponse.json({ data: { recoveryCodes: [] }, meta: null, warnings: [] }),
      ),
    );

    // .min(1) — a panel rendering "save these codes" above nothing is worse than a hard failure.
    await expect(SessionRepository.totpVerify("123456")).rejects.toThrow();
  });
});
