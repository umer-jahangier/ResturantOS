import { post } from "@/lib/api-client/request";
import {
  apiLoginSchema,
  apiTokenSchema,
  apiTotpSetupSchema,
} from "@/lib/api-client/schemas/auth.schema";
import { adaptSession, adaptTokenSession } from "@/lib/adapters/auth.adapter";
import type {
  ForcedPasswordChangeBody,
  LoginBody,
  Session,
  TotpBootstrapBody,
  TotpSetup,
} from "@/lib/models/auth.model";

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

  /**
   * Start first-time TOTP enrolment (GA-008): issue a secret for an account that is locked out of
   * login until it has one.
   *
   * Public at the gateway by necessity and re-authenticated by password on every call. Returns the
   * `otpauth://` provisioning URI; nothing is activated until {@link totpBootstrapVerify} succeeds,
   * so an abandoned enrolment leaves the account exactly as it was.
   */
  async totpBootstrap(body: TotpBootstrapBody): Promise<TotpSetup> {
    const raw = await post<TotpBootstrapBody>("/api/v1/auth/2fa/bootstrap", body);
    return apiTotpSetupSchema.parse(raw);
  },

  /**
   * Activate the secret issued by {@link totpBootstrap} by proving the user's authenticator
   * produces the right code.
   *
   * No response is parsed because there is none: the endpoint returns `{data: null}` and issues no
   * credential. The user goes back to the login form and signs in normally — enrolment and
   * authentication stay separate, so completing enrolment never doubles as a login.
   */
  async totpBootstrapVerify(body: TotpBootstrapBody): Promise<void> {
    await post<TotpBootstrapBody>("/api/v1/auth/2fa/bootstrap/verify", body);
  },

  async switchBranch(branchId: string): Promise<Session> {
    const raw = await post("/api/v1/auth/switch-branch", { branchId });
    return adaptTokenSession(apiTokenSchema.parse(raw));
  },
};
