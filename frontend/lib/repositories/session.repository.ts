import { get, post } from "@/lib/api-client/request";
import {
  apiLoginSchema,
  apiTokenSchema,
  apiRecoveryCodesSchema,
  apiTotpSetupSchema,
  apiTwoFactorStatusSchema,
} from "@/lib/api-client/schemas/auth.schema";
import { adaptSession, adaptTokenSession } from "@/lib/adapters/auth.adapter";
import type {
  ForcedPasswordChangeBody,
  LoginBody,
  RecoveryCodes,
  Session,
  TwoFactorStatus,
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
   * produces the right code, and receive the account's recovery codes.
   *
   * Still issues no credential: the user goes back to the login form and signs in normally, so
   * enrolment and authentication stay two events with two audit records. What changed is that the
   * response is no longer empty — it carries the recovery codes, the only time they are ever sent —
   * so the caller MUST surface them rather than discarding the resolved value.
   */
  async totpBootstrapVerify(body: TotpBootstrapBody): Promise<RecoveryCodes> {
    const raw = await post<TotpBootstrapBody>("/api/v1/auth/2fa/bootstrap/verify", body);
    return apiRecoveryCodesSchema.parse(raw);
  },

  // ---- Managing a second factor from Settings, with a session already in hand. --------------
  // These are the authenticated counterparts of the bootstrap pair above. Bootstrap exists only to
  // break the no-token-without-a-code deadlock and refuses once a secret exists; everything a
  // signed-in user does to their own second factor goes through here.

  async totpStatus(): Promise<TwoFactorStatus> {
    return apiTwoFactorStatusSchema.parse(await get("/api/v1/auth/2fa/status"));
  },

  /** Issues a secret but does not activate it — nothing changes until {@link totpVerify}. */
  async totpSetup(): Promise<TotpSetup> {
    return apiTotpSetupSchema.parse(await post("/api/v1/auth/2fa/setup"));
  },

  /** Activates the secret and returns the recovery codes. Shown once; see {@link RecoveryCodes}. */
  async totpVerify(code: string): Promise<RecoveryCodes> {
    return apiRecoveryCodesSchema.parse(await post("/api/v1/auth/2fa/verify", { code }));
  },

  /**
   * Replaces the recovery-code set, invalidating every previous code.
   *
   * Takes a LIVE authenticator code, never a recovery code — the server enforces that asymmetry so
   * that someone holding a stolen printed list cannot replace it with one only they hold.
   */
  async totpRegenerateRecoveryCodes(code: string): Promise<RecoveryCodes> {
    return apiRecoveryCodesSchema.parse(await post("/api/v1/auth/2fa/recovery-codes", { code }));
  },

  /** Accepts an authenticator code OR a recovery code — the lost-phone repair path. */
  async totpDisable(code: string): Promise<void> {
    await post("/api/v1/auth/2fa/disable", { code });
  },

  async switchBranch(branchId: string): Promise<Session> {
    const raw = await post("/api/v1/auth/switch-branch", { branchId });
    return adaptTokenSession(apiTokenSchema.parse(raw));
  },
};
