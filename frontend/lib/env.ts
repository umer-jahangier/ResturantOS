// Typed accessors for the NEXT_PUBLIC_* environment variables (Doc 05).
// Direct static references are required so Next.js can inline these into the
// client bundle at build time (dynamic process.env[key] access would not inline).

export const env = {
  NEXT_PUBLIC_API_BASE_URL:
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080",
  NEXT_PUBLIC_WS_BASE_URL:
    process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8080",
  NEXT_PUBLIC_ENABLE_MSW: process.env.NEXT_PUBLIC_ENABLE_MSW ?? "false",
} as const;

/** True when the MSW mock worker should run (dev/test only — never prod). */
export function isMswEnabled(): boolean {
  return env.NEXT_PUBLIC_ENABLE_MSW === "true" && process.env.NODE_ENV !== "production";
}
