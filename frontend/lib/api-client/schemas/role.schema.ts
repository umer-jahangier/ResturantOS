import { z } from "zod";

/**
 * Wire schemas for the ROLE BUILDER (S3) — the permission vocabulary and the three writes that
 * compose a role out of it.
 *
 * <p>The READ of the role list itself lives in `user.schema.ts` alongside the assign dialog that
 * shares it: both screens call `GET /api/v1/roles` and both need the identical ceiling-filtered
 * answer, so there is one schema for one endpoint. What is here is everything that endpoint's
 * catalogue could not already express.
 *
 * <p>No `tenantId` and no `code` on any request, and both absences are the enforcement rather than
 * an oversight. The tenant comes from the signature-verified JWT at the gateway. The role CODE is
 * derived server-side from the name: a caller-supplied code could be `OWNER`, and a tenant row
 * sharing a system role's code is the one collision the tenant-scoped catalogue cannot resolve.
 */

/** One permission, as `GET /api/v1/permissions` returns it inside its module. */
export const apiPermissionEntrySchema = z.object({
  code: z.string(),
  module: z.string(),
  // Seeded for every code today, but the column is nullable and a missing sentence must render as
  // a missing sentence rather than as the word "undefined" next to a checkbox.
  description: z.string().nullable().optional(),
});

/**
 * One module and the permissions it owns.
 *
 * <p>Grouped by the SERVER, deliberately. Re-deriving the grouping in the browser would mean
 * splitting codes on a dot, which breaks the day a module name contains one — and would give every
 * client its own slightly different idea of what a module is.
 */
export const apiPermissionModuleSchema = z.object({
  module: z.string(),
  permissions: z.array(apiPermissionEntrySchema),
});

export type ApiPermissionEntry = z.infer<typeof apiPermissionEntrySchema>;
export type ApiPermissionModule = z.infer<typeof apiPermissionModuleSchema>;

/**
 * The body of `POST /api/v1/roles` and `PUT /api/v1/roles/{code}` — the same shape, because the two
 * are the same statement: this role now grants exactly these codes.
 *
 * <p>Validated on the way OUT as well as in. The server refuses an empty list with a 400, and a
 * request that could only ever be refused should not leave the browser at all: the user gets the
 * same sentence without a round trip, and the form can point at the control that is wrong.
 */
export const apiRoleWriteRequestSchema = z.object({
  name: z.string().trim().min(2).max(60),
  permissions: z.array(z.string()).min(1),
});

export type ApiRoleWriteRequest = z.infer<typeof apiRoleWriteRequestSchema>;
