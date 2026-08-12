// Shared error barrel. Importable from ANY layer, components included — unlike
// `@/lib/api-client/errors`, which is Layer-1 and off-limits to `components/**`
// under the FE-08 boundary rule in eslint.config.mjs.
export {
  ApiError,
  type ApiFieldError,
  type AccessRefusalKind,
  accessRefusalKind,
  accessRefusalMessage,
  isServiceOutage,
} from "./api-error";
export { formatUserFacingError } from "./user-facing";
