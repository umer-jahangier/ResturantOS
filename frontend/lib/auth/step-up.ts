// Step-up (TOTP) re-authentication routing.
//
// auth-service mints the `totp_verified` access-token claim ONLY at a login that verified a TOTP
// code, and deliberately does not carry it across refresh: an access token lives an hour, a refresh
// token thirty days, and re-minting an hour-grade proof of possession onto a month-long bearer
// credential would hand a stolen refresh token the very capability the gate withholds.
//
// The consequence is a real, expected state for a signed-in user: roughly an hour after login, a
// step-up-gated action (payroll approval, accounting-period close) starts failing with
// `TOTP_REQUIRED` while the session itself is perfectly valid. There is no code the client can
// send to satisfy the gate after the fact and no step-up endpoint to call — auth-service exposes
// only enrolment (`/api/v1/auth/2fa/**`), not re-verification. The single remedy is one more login
// with a code, which is what this module routes to.

/** `?reason=` value the login screen renders its step-up explanation from. */
export const STEP_UP_LOGIN_REASON = "step_up_required";

/** `?next=` — where to send the user back to once they have re-authenticated. */
export const RETURN_PATH_PARAM = "next";

/** Anything below 0x20, plus DEL. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/**
 * Reduce an untrusted `?next=` to a same-origin path, or null.
 *
 * `next` reaches the login screen through the URL, so it is attacker-supplied by construction:
 * a link to `/login?next=https://evil.example/pay` would otherwise turn our own post-login
 * redirect into an open redirect — the most credible possible phishing hop, since the victim
 * really did just authenticate on the real site.
 *
 * Only a single-slash absolute path survives. `//evil.example` (protocol-relative) and
 * `/\evil.example` (which several browsers normalise to the same thing) are rejected along with
 * anything carrying a scheme or a control character.
 */
export function sanitizeReturnPath(next: string | null | undefined): string | null {
  if (!next) return null;

  const trimmed = next.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return null;
  if (trimmed.includes("://")) return null;
  if (CONTROL_CHARACTERS.test(trimmed)) return null;

  return trimmed;
}

/**
 * Login href that explains itself and comes back. `returnPath` is sanitised here too, so callers
 * may pass a `usePathname()` result straight through without repeating the check.
 */
export function buildStepUpLoginHref(returnPath?: string | null): string {
  const params = new URLSearchParams({ reason: STEP_UP_LOGIN_REASON });
  const safe = sanitizeReturnPath(returnPath);
  if (safe) params.set(RETURN_PATH_PARAM, safe);
  return `/login?${params.toString()}`;
}
