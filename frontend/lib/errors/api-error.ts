// Transport-agnostic error vocabulary.
//
// `ApiError` and the user-facing message mapping used to live in `lib/api-client/`,
// which made every consumer of them a Layer-1 importer — including components, which the
// FE-08 layer boundary (eslint `no-restricted-imports`) forbids. Nothing here knows about
// axios or HTTP transport: this is the normalised error SHAPE plus the predicates callers
// branch on. `lib/api-client/errors.ts` still owns the axios→`ApiError` parsing, and
// re-exports these so existing Layer-1/2 imports keep working unchanged.

/** One field-level validation failure, as carried in the `{error:{details}}` envelope. */
export interface ApiFieldError {
  field: string;
  issue: string;
}

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
  /**
   * 401 — the account's permissions demand a second factor and none has ever been enrolled.
   * Distinct from {@link isTotpRequired}: there is no code to type, so prompting for one strands
   * the user. They must enrol first, at {@code POST /api/v1/auth/2fa/bootstrap}.
   */
  isTotpEnrollmentRequired(): boolean {
    return this.code === "TOTP_ENROLLMENT_REQUIRED";
  }
  /**
   * 409 — the credential verified in more than one place and the user must choose (16a-01).
   *
   * `fieldErrors` carries one entry per option: `field` is the slug to echo back as `tenantSlug`,
   * `issue` is the display name. Every entry is a place the password ACTUALLY matched — auth-service
   * builds the list after the bcrypt comparison, never before — so rendering it discloses nothing a
   * caller has not already proven.
   */
  isTenantSelectionRequired(): boolean {
    return this.code === "TENANT_SELECTION_REQUIRED";
  }
  /**
   * 403 — the password is correct but must be changed before a session is issued (D-17).
   *
   * 403 rather than 401 on purpose: re-prompting for the password (the natural response to a 401)
   * would loop forever. `fieldErrors` carries `changeToken` and `expiresAt`.
   */
  isPasswordChangeRequired(): boolean {
    return this.code === "PASSWORD_CHANGE_REQUIRED";
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
