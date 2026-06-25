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

function isAuthEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes("/api/v1/auth/login") || url.includes("/api/v1/auth/refresh");
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
