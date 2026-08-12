import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { env } from "@/lib/env";
import { getSession, refreshSession } from "@/lib/auth/session";
import { parseApiError } from "./errors";

// Layer-1 axios instance. baseURL is the Phase-3 gateway. `withCredentials`
// sends the HttpOnly `refresh_token` cookie on /api/v1/auth/* calls.
interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const apiClient = axios.create({
  baseURL: env.NEXT_PUBLIC_API_BASE_URL,
  timeout: 30_000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// Request interceptor: inject the in-memory Bearer + a per-request correlation id.
apiClient.interceptors.request.use((config) => {
  const session = getSession();
  if (session?.accessToken) {
    config.headers.set("Authorization", `Bearer ${session.accessToken}`);
  }
  config.headers.set("X-Request-Id", crypto.randomUUID());
  return config;
});

/**
 * The endpoints where a 401 means "that credential is wrong", NOT "your session expired".
 *
 * <p>Every one of these is in the gateway's {@code JwtGlobalFilter.PUBLIC_PATHS}: the caller holds
 * no token and cannot obtain one until the call succeeds. Refreshing on their behalf is impossible
 * (there is nothing to refresh) and bouncing them to {@code /login?reason=session_expired} tells a
 * new hire their session ended when they never had one — and destroys the page state that held
 * their in-memory change token or their live password.
 *
 * <p><b>Found by driving it (F12).</b> Only {@code /login} and {@code /refresh} were listed, so a
 * wrong one-time password on the forced-change panel answered 401, the interceptor tried a refresh,
 * failed, and hard-navigated to the sign-in screen with "Your session expired." The panel's own
 * refusal message — "That link has expired or the current password is wrong" — had never once been
 * seen by a user, because the navigation always won.
 *
 * <p><b>{@code /change-password/forced} is listed in full, never as {@code /change-password}.</b>
 * The bare prefix would also match the AUTHENTICATED self-service endpoint at
 * {@code POST /api/v1/auth/change-password}, where a 401 genuinely does mean the session went away
 * and the refresh-then-redirect is the right answer. The gateway's list carries the same warning
 * for the same reason.
 */
const CREDENTIAL_ENDPOINTS = [
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/change-password/forced",
  // Covers /2fa/bootstrap and /2fa/bootstrap/verify — first-time TOTP enrolment, which happens
  // before the account can sign in at all.
  "/api/v1/auth/2fa/bootstrap",
  "/api/v1/auth/reset-password",
  "/api/v1/platform/auth/login",
];

function isAuthEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  return CREDENTIAL_ENDPOINTS.some((path) => url.includes(path));
}

// Response interceptor: refresh-on-401 (once), then retry; otherwise redirect to
// login (browser) and always reject with a normalised ApiError.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (error instanceof AxiosError) {
      const original = error.config as RetryableConfig | undefined;
      const shouldRefresh =
        error.response?.status === 401 &&
        original !== undefined &&
        original._retry !== true &&
        !isAuthEndpoint(original.url);

      if (shouldRefresh && original) {
        original._retry = true;
        const refreshed = await refreshSession();
        if (refreshed) {
          return apiClient(original);
        }
        if (typeof window !== "undefined") {
          window.location.href = "/login?reason=session_expired";
        }
      }
    }
    return Promise.reject(parseApiError(error));
  },
);
