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
    const session = await SessionRepository.switchBranch(
      "44444444-4444-4444-8444-444444444444",
    );

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
