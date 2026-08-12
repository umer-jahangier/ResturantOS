import { z } from "zod";

/**
 * Wire schema for the branch record behind Settings → Branch details.
 *
 * <p><b>Why a BRANCH and not a "tenant settings" object.</b> There is no tenant-settings API. It was
 * measured, not assumed — as TENANT_ADMIN, through the real gateway, on 2026-08-11:
 *
 * <pre>
 *   GET /api/v1/tenant-profile ............... 404
 *   GET /api/v1/tenants/{id}/settings ........ 404
 *   GET /api/v1/tenants/{id}/theme ........... 404
 *   GET /api/v1/settings ..................... 404
 *   GET /api/v1/onboarding ................... 404
 *   GET /api/v1/branches/{id} ................ 200
 *   PUT /api/v1/branches/{id} ................ 200
 * </pre>
 *
 * <p>`PUT /api/v1/branches/{id}` (user-service `BranchController`, gated on
 * `rbac.manage | branch.manage`) is the one configuration surface in this product that genuinely
 * persists. Building the settings screen on it means the page saves something real; the fields it
 * cannot persist are labelled as such rather than accepted and dropped.
 */
export const apiBranchSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  isHq: z.boolean(),
  isActive: z.boolean(),
  address: z.string().nullable().optional(),
  // Read-only here: `UpdateBranchRequest` has no field for either, so they cannot be edited
  // through this endpoint and the form must not pretend otherwise.
  fbrStrn: z.string().nullable().optional(),
  ntn: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  currencyConfig: z.string().nullable().optional(),
  receiptConfig: z.string().nullable().optional(),
  openedOn: z.string().nullable().optional(),
});

export type ApiBranch = z.infer<typeof apiBranchSchema>;

/**
 * `PUT /api/v1/branches/{id}` — patch semantics despite the verb.
 *
 * <p>`BranchService.update` applies each field only when it is non-null
 * (`if (req.name() != null) …`, one line per field), so an omitted key leaves the stored value
 * alone. Verified live with an empty body: `PUT {}` answered 200 and the branch came back byte-for-
 * byte unchanged. That is what lets this form send only what the user edited instead of echoing
 * every field back and risking a blank input wiping a stored value.
 */
export const apiUpdateBranchSchema = z.object({
  name: z.string().max(150).optional(),
  isActive: z.boolean().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  timezone: z.string().optional(),
  openedOn: z.string().optional(),
});

/**
 * `POST /api/v1/branches` — the wire shape of a new branch.
 *
 * <p>Deliberately NOT `apiUpdateBranchSchema.partial()`: create and update accept different things
 * and mean different things by an absent key. `name` is required here (the server's
 * `@NotBlank`), `isActive` is absent because a branch is created active and the server ignores an
 * attempt to say otherwise, and `isHq` is absent because HQ is decided when the tenant is
 * provisioned — offering it would let a second HQ be created through a screen with no concept of
 * what that would mean.
 */
export const apiCreateBranchSchema = z.object({
  name: z.string().min(1).max(150),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  timezone: z.string().optional(),
  openedOn: z.string().optional(),
});
