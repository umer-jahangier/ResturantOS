import { post } from "@/lib/api-client/request";
import { apiLoginSchema, apiTokenSchema } from "@/lib/api-client/schemas/auth.schema";
import { adaptSession, adaptTokenSession } from "@/lib/adapters/auth.adapter";
import type { ForcedPasswordChangeBody, LoginBody, Session } from "@/lib/models/auth.model";

// Layer-2c repository: request → Zod `.parse()` (throws on drift) → adapt.
// ALWAYS `.parse()` — never the non-throwing variant that would silently
// swallow schema drift.
export const SessionRepository = {
  async login(body: LoginBody): Promise<Session> {
    const raw = await post<LoginBody>("/api/v1/auth/login", body);
    return adaptSession(apiLoginSchema.parse(raw));
  },

  async refresh(): Promise<Session> {
    const raw = await post("/api/v1/auth/refresh");
    return adaptTokenSession(apiTokenSchema.parse(raw));
  },

  async logout(): Promise<void> {
    await post("/api/v1/auth/logout");
  },

  /**
   * Redeem a single-use change token from a `403 PASSWORD_CHANGE_REQUIRED` (13-08).
   *
   * No response is parsed because there is nothing to parse: the endpoint returns
   * `{data: null}` and issues no credential of any kind.
   */
  async forcedPasswordChange(body: ForcedPasswordChangeBody): Promise<void> {
    await post("/api/v1/auth/change-password/forced", body);
  },

  async switchBranch(branchId: string): Promise<Session> {
    const raw = await post("/api/v1/auth/switch-branch", { branchId });
    return adaptTokenSession(apiTokenSchema.parse(raw));
  },
};
