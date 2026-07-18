import { AxiosError } from "axios";
import { ZodError } from "zod";
import type { ApiErrorBody, ApiFieldError } from "./types";

// Normalised API error. Wraps the `{error:{code,message,details,traceId}}`
// envelope plus the HTTP status so callers can branch on stable codes.
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly traceId: string | null;
  readonly fieldErrors: ApiFieldError[];

  constructor(params: {
    code: string;
    message: string;
    status: number;
    traceId: string | null;
    fieldErrors: ApiFieldError[];
  }) {
    super(params.message);
    this.name = "ApiError";
    this.code = params.code;
    this.status = params.status;
    this.traceId = params.traceId;
    this.fieldErrors = params.fieldErrors;
  }

  // ── Live auth-service codes (verified in AuthExceptionHandler) ──────────────
  /** 401 — bad credentials OR suspended/non-ACTIVE tenant (masked, never leaks tenant status). */
  isUnauthenticated(): boolean {
    return this.code === "UNAUTHENTICATED";
  }
  /** 423 LOCKED (NOT 401) — account is locked. */
  isAccountLocked(): boolean {
    return this.code === "ACCOUNT_LOCKED";
  }
  /** 401 — TOTP step-up required; retry login with `totpCode`. */
  isTotpRequired(): boolean {
    return this.code === "TOTP_REQUIRED";
  }
  /** 403 — branch-switch denied (used by the 04-02 BranchSwitcher). */
  isBranchAccessDenied(): boolean {
    return this.code === "BRANCH_ACCESS_DENIED";
  }
  /** 400 — new password reuses a previous one. */
  isPasswordReuse(): boolean {
    return this.code === "PASSWORD_REUSE";
  }

  // ── Phase-3 GATEWAY / shared-lib codes (NOT emitted by auth-service) ─────────
  // Kept for downstream module phases; these originate at the gateway, not auth.
  isPermissionDenied(): boolean {
    return this.code === "PERMISSION_DENIED";
  }
  isFeatureDisabled(): boolean {
    return this.code === "FEATURE_DISABLED";
  }
  isQuotaExceeded(): boolean {
    return this.code === "QUOTA_EXCEEDED";
  }
  isValidationFailed(): boolean {
    return this.code === "VALIDATION_FAILED";
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: unknown }).error !== null
  );
}

/** Finance-service flat error shape: `{ code, message, timestamp }`. */
function isFlatErrorBody(
  value: unknown,
): value is { code: string; message: string; traceId?: string | null } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as { code: unknown }).code === "string" &&
    typeof (value as { message: unknown }).message === "string"
  );
}

/**
 * RFC-7807 ProblemDetail shape emitted by the Spring MVC services (pos-service,
 * kitchen-service, …): `{ type, title, status, detail, instance, ...properties }`.
 * Custom handlers set `title` to a SCREAMING_SNAKE code (e.g. `TILL_HAS_OPEN_ORDERS`)
 * and `detail` to the human message; default Spring handlers set `title` to the reason
 * phrase ("Conflict"). Detected last so the two richer envelopes above win.
 */
type ProblemDetailBody = {
  type?: string;
  title?: string;
  detail?: string;
  status?: number;
  properties?: Record<string, unknown> | null;
  traceId?: string | null;
  errors?: unknown;
  /**
   * `ProblemDetail#setProperty("code", ...)` is flattened onto the JSON root by Spring's
   * `ProblemDetailJacksonMixin` — NOT nested under a `properties` key. `NlqGlobalExceptionHandler`
   * uses this to carry the SPECIFIC failure code (e.g. `TENANT_FILTER_MISSING`,
   * `QUOTA_EXCEEDED_MONTHLY`) alongside a generic `title` category (e.g. `QUERY_REJECTED`).
   */
  code?: string;
};

function isProblemDetailBody(value: unknown): value is ProblemDetailBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const hasDetail = typeof v.detail === "string";
  const hasTitle = typeof v.title === "string";
  // A ProblemDetail always carries a numeric `status`, plus at least a title or detail.
  return (hasDetail || hasTitle) && typeof v.status === "number";
}

const CODE_LIKE = /^[A-Z][A-Z0-9_]+$/;

function problemDetailTraceId(body: ProblemDetailBody): string | null {
  if (typeof body.traceId === "string") return body.traceId;
  const props = body.properties;
  if (props && typeof props === "object" && typeof props.traceId === "string") {
    return props.traceId;
  }
  return null;
}

function problemDetailFieldErrors(body: ProblemDetailBody): ApiFieldError[] {
  const raw = Array.isArray(body.errors)
    ? body.errors
    : Array.isArray(body.properties?.errors)
      ? (body.properties?.errors as unknown[])
      : [];
  return raw
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const rec = e as Record<string, unknown>;
      const field = String(rec.field ?? "");
      const issue = String(rec.issue ?? rec.message ?? rec.defaultMessage ?? "");
      return field ? { field, issue } : null;
    })
    .filter((e): e is ApiFieldError => e !== null);
}

const UNKNOWN_ERROR_MSG = "Something went wrong. Please try again.";

const USER_FACING_BY_CODE: Record<string, string> = {
  JE_UNBALANCED: "Journal entry lines must balance (total debit must equal total credit).",
  PERIOD_LOCKED: "This accounting period is locked. Posting is not allowed.",
  JE_ALREADY_POSTED: "This journal entry has already been posted.",
  PERIOD_ALREADY_LOCKED: "This period is already closed.",
  PERIOD_PRE_CHECK_FAILED: "Period cannot be closed yet. Resolve open items first.",
  INVALID_OPERATION: "This action is not allowed in the current state.",
  PERMISSION_DENIED: "You don't have permission to perform this action.",
  UNAUTHENTICATED: "Please sign in again.",
  TOTP_REQUIRED: "A verification code is required for this action.",
  VALIDATION_FAILED: "Please check your input and try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
  NETWORK_ERROR: "Unable to reach the server. Check your connection and try again.",
  UNKNOWN_ERROR: "Something went wrong. Please try again.",
};

function looksLikeValidationDump(message: string): boolean {
  const trimmed = message.trim();
  return (
    trimmed.startsWith("[") ||
    trimmed.includes('"invalid_type"') ||
    trimmed.includes('"code":"invalid_type"')
  );
}

/** Map any thrown value to a short, user-safe message (never raw Zod/JSON dumps). */
export function formatUserFacingError(error: unknown): string {
  if (error instanceof ApiError) {
    return USER_FACING_BY_CODE[error.code] ?? sanitizeMessage(error.message);
  }
  if (error instanceof ZodError) {
    return "We couldn't read the server response. Please refresh and try again.";
  }
  if (error instanceof Error) {
    if (looksLikeValidationDump(error.message)) {
      return "We couldn't read the server response. Please refresh and try again.";
    }
    return sanitizeMessage(error.message);
  }
  return UNKNOWN_ERROR_MSG;
}

function sanitizeMessage(message: string): string {
  if (!message || looksLikeValidationDump(message)) {
    return UNKNOWN_ERROR_MSG;
  }
  if (message.length > 160) {
    return UNKNOWN_ERROR_MSG;
  }
  return message;
}

/** Convert any thrown value (typically an AxiosError) into a typed {@link ApiError}. */
export function parseApiError(error: unknown): ApiError {
  if (error instanceof AxiosError) {
    const status = error.response?.status ?? 0;
    const body = error.response?.data;

    if (isApiErrorBody(body)) {
      return new ApiError({
        code: body.error.code,
        message: body.error.message,
        status,
        traceId: body.error.traceId ?? null,
        fieldErrors: Array.isArray(body.error.details) ? body.error.details : [],
      });
    }

    if (isFlatErrorBody(body)) {
      return new ApiError({
        code: body.code,
        message: body.message,
        status,
        traceId: body.traceId ?? null,
        fieldErrors: [],
      });
    }

    if (isProblemDetailBody(body)) {
      const title = typeof body.title === "string" ? body.title : "";
      // nlq-service's NlqGlobalExceptionHandler sets `title` to a generic category
      // (e.g. "QUERY_REJECTED", "QUOTA_EXCEEDED") and the SPECIFIC code (the actual
      // RejectionCode, e.g. "TENANT_FILTER_MISSING") on the flattened `code` property —
      // prefer it when present so callers can branch on the granular code, not the category.
      const propsCode =
        typeof body.code === "string"
          ? body.code
          : typeof body.properties?.code === "string"
            ? body.properties.code
            : "";
      const code = CODE_LIKE.test(propsCode)
        ? propsCode
        : CODE_LIKE.test(title)
          ? title
          : `HTTP_${status || body.status || 0}`;
      const message =
        (typeof body.detail === "string" && body.detail) ||
        (title && !CODE_LIKE.test(title) ? title : "") ||
        error.message;
      return new ApiError({
        code,
        message,
        status: status || body.status || 0,
        traceId: problemDetailTraceId(body),
        fieldErrors: problemDetailFieldErrors(body),
      });
    }

    return new ApiError({
      code: "NETWORK_ERROR",
      message: error.message,
      status,
      traceId: null,
      fieldErrors: [],
    });
  }

  return new ApiError({
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : "Unknown error",
    status: 0,
    traceId: null,
    fieldErrors: [],
  });
}
