import { AxiosError } from "axios";
import { ApiError, type ApiFieldError } from "@/lib/errors/api-error";
import type { ApiErrorBody } from "./types";

// Layer-1 error parsing: axios rejection → normalised `ApiError`.
//
// The `ApiError` shape itself and the user-facing message mapping live in `@/lib/errors`
// so that `components/**` can use them without importing the api-client (FE-08 layer
// boundary). Both are re-exported here so existing Layer-1/2/3 imports of
// `@/lib/api-client/errors` keep working.
export { ApiError, type ApiFieldError } from "@/lib/errors/api-error";
export { formatUserFacingError } from "@/lib/errors/user-facing";

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
