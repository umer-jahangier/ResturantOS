import { AxiosError } from "axios";
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
