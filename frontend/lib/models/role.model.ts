/**
 * Domain shapes for the role builder (S3).
 *
 * <p>The role itself is {@link import("./user.model").AssignableRole} — one type for one endpoint,
 * shared with the assign dialog, so "what does this role grant" cannot come to mean two different
 * things on two screens.
 */

/** One permission the platform understands. */
export interface PermissionEntry {
  code: string;
  module: string;
  /** Null when the catalogue has no sentence for the code — rendered as absent, never as "null". */
  description: string | null;
}

/** One module and the permissions it owns, as the server grouped them. */
export interface PermissionModule {
  module: string;
  permissions: PermissionEntry[];
}

/**
 * What the builder sends.
 *
 * <p>No `code`: the server derives it from the name. That is not a simplification — a
 * caller-supplied code could collide with a built-in role's, which is the one collision the
 * tenant-scoped catalogue cannot resolve.
 */
export interface RoleWritePayload {
  name: string;
  permissions: string[];
}
