// Shared response envelope — mirrors shared-lib `ApiResponse<T>` / `PageMeta` /
// `ApiWarning` exactly so the typed request helpers can unwrap `.data.data`.

// `ApiFieldError` is defined alongside `ApiError` in the transport-agnostic `@/lib/errors`
// module (so `components/**` can reach it without crossing the FE-08 layer boundary) and
// re-exported here, where the envelope types that carry it live.
import type { ApiFieldError } from "@/lib/errors/api-error";

export type { ApiFieldError };

export interface ApiWarning {
  code: string;
  message: string;
}

/**
 * Mirrors shared-lib `PageMeta(Page page, Long totalCount)` — `cursor`/`nextCursor` carry the
 * page NUMBER as a string (backends build them from `Page.getNumber()`), and `nextCursor` is
 * null on the last page.
 */
export interface PageMeta {
  page: {
    cursor: string;
    nextCursor: string | null;
    limit: number;
  };
  totalCount: number;
}

/** `{ data, meta, warnings }` — meta is null for non-paginated responses. */
export interface ApiResponse<T> {
  data: T;
  meta: PageMeta | null;
  warnings: ApiWarning[];
}

/** Paginated envelope: `data` is the page array, `meta` is always present. */
export interface ApiPaginatedResponse<T> {
  data: T[];
  meta: PageMeta;
  warnings: ApiWarning[];
}

/** Raw error envelope: `{ error: { code, message, details, traceId } }`. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: ApiFieldError[];
    traceId: string;
  };
}
