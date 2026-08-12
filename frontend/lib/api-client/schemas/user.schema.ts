import { z } from "zod";

/**
 * Wire schemas for the tenant-admin user surface.
 *
 * <p>Two services answer here and the split is deliberate:
 *
 * <ul>
 *   <li><b>user-service</b> owns <code>/api/v1/users/**</code> — list, get, create, patch,
 *       deactivate, reactivate, admin reset, branch-role assignment (plans 13-12, 13-13).</li>
 *   <li><b>auth-service</b> owns <code>/api/v1/roles</code> — the CEILING-FILTERED catalogue of
 *       roles the caller may assign (plan 13-07).</li>
 * </ul>
 *
 * <p>Nothing here declares a <code>tenantId</code> field on a REQUEST, and that absence is the
 * enforcement rather than an omission: 13-12 §4 records that the public create DTO has no tenant
 * field precisely so a body carrying one is dropped, and the scope comes from the signature-verified
 * JWT. A schema that added the field back would make the frontend the first place in the stack that
 * believes a client can name its own tenant.
 *
 * <p>Likewise there is no password field on create or update. `POST /api/v1/users` MINTS a
 * temporary password and returns it once; `PATCH /api/v1/users/{id}` REFUSES a body carrying
 * `password` / `newPassword` / `passwordHash` / `temp_password` with a 400 (13-12 §4, enforced with
 * `@JsonAnySetter` so it covers what a caller actually sent). Adding one here would build a form
 * whose only possible outcome is a validation error.
 */

/** One row of `GET /api/v1/users`, and the `user` half of `GET /api/v1/users/{id}`. */
export const apiUserSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  // Nullable in practice: 13-12's create accepts an account with no display name.
  fullName: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  active: z.boolean(),
  mustChangePassword: z.boolean(),
  totpEnabled: z.boolean(),
  lastLoginAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

export type ApiUserSummary = z.infer<typeof apiUserSummarySchema>;

/**
 * One active branch-role row.
 *
 * <p>An EMPTY `assignments` array is the visible form of an account that cannot log in at all
 * (13-12 §4). The UI must say so in words rather than render an empty table cell, which is why this
 * shape is surfaced on the summary model rather than hidden inside a detail panel.
 */
export const apiBranchRoleAssignmentSchema = z.object({
  branchId: z.string().uuid(),
  roleCode: z.string(),
  primary: z.boolean(),
  approvalLimitPaisa: z.number().int().nullable().optional(),
});

export type ApiBranchRoleAssignment = z.infer<typeof apiBranchRoleAssignmentSchema>;

export const apiUserDetailSchema = z.object({
  user: apiUserSummarySchema,
  assignments: z.array(apiBranchRoleAssignmentSchema),
});

export type ApiUserDetail = z.infer<typeof apiUserDetailSchema>;

/**
 * `POST /api/v1/users` → 201.
 *
 * <p>`tempPassword` crosses back exactly ONCE and is never retrievable again — auth-service stores
 * only its hash and 13-12 overrode `CreatedUser.toString()` to `<redacted>` so it cannot reach a
 * log by accident. The UI's obligation follows from that and not from taste: show it, let it be
 * copied, and say plainly that it will not be shown again.
 */
export const apiCreatedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  tempPassword: z.string(),
  mustChangePassword: z.boolean(),
  branchId: z.string().uuid().nullable().optional(),
  assignedRoleCode: z.string().nullable().optional(),
  loginable: z.boolean(),
});

export type ApiCreatedUser = z.infer<typeof apiCreatedUserSchema>;

/** `POST /api/v1/users/{userId}/reset-password` → 200 (13-13 §3). */
export const apiAdminResetResultSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  tempPassword: z.string(),
  mustChangePassword: z.boolean(),
});

export type ApiAdminResetResult = z.infer<typeof apiAdminResetResultSchema>;

/**
 * `POST /api/v1/users/{userId}/branch-roles` request body.
 *
 * `approvalLimitPaisa` is an INTEGER number of paisa, or `null` for no approval authority. Declared
 * here so a float can never reach the wire: `z.number().int()` rejects `1250049.9999999998`, which
 * is what `19999.99 * 100 * ...` style arithmetic produces and what a money field must never send.
 */
export const apiAssignBranchRoleRequestSchema = z.object({
  branchId: z.string().uuid(),
  roleCode: z.string().min(1),
  approvalLimitPaisa: z.number().int().nonnegative().nullable().optional(),
});

export type ApiAssignBranchRoleRequest = z.infer<typeof apiAssignBranchRoleRequestSchema>;

/** `POST /api/v1/users/{userId}/branch-roles` → the assignment plus whatever it displaced. */
export const apiBranchRoleWriteResultSchema = z.object({
  branchId: z.string().uuid(),
  roleCode: z.string(),
  // Non-null when the write replaced an existing role on that branch — one active role per
  // branch is a 13-02 invariant, so an assignment can silently remove another unless it is shown.
  displacedRoleCode: z.string().nullable().optional(),
});

export type ApiBranchRoleWriteResult = z.infer<typeof apiBranchRoleWriteResultSchema>;

/**
 * One entry of `GET /api/v1/roles` (auth-service, plan 13-07).
 *
 * <p>The list is already filtered to the roles THIS caller may assign: a role appears only if every
 * permission it grants is one the caller holds. That is a privilege-escalation control, not a
 * convenience — TENANT_ADMIN deliberately lacks `rbac.manage`, and an unfiltered picker would let it
 * mint an OWNER account and log in as one. The frontend therefore never hardcodes a role list and
 * never filters this array further; doing either would put a second, weaker copy of the rule in the
 * one place an attacker controls.
 */
export const apiRoleEntrySchema = z.object({
  code: z.string(),
  name: z.string(),
  system: z.boolean(),
  permissions: z.array(z.string()),
  /**
   * How many DISTINCT people in this tenant hold the role (S3).
   *
   * <p>Optional on the wire on purpose. A browser tab left open across a deploy talks to whichever
   * auth-service answers, and an older one does not send this key; a required field would turn that
   * into a parse failure on the ASSIGN dialog — a screen that has nothing to do with the count.
   * Absent becomes `0` in the adapter, which is the only reading that cannot invent holders.
   */
  assignedUserCount: z.number().int().nonnegative().optional(),
});

export type ApiRoleEntry = z.infer<typeof apiRoleEntrySchema>;

/**
 * The envelope warning 13-07 emits when the ceiling withheld something.
 *
 * <p>It reports a COUNT and never names the withheld roles — naming them would republish exactly
 * what the ceiling withholds. It is surfaced in the UI rather than dropped because a bare silence
 * turns "why is OWNER missing from my picker" into a support ticket.
 */
export const apiWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const apiAssignableRolesEnvelopeSchema = z.object({
  data: z.array(apiRoleEntrySchema),
  warnings: z.array(apiWarningSchema).nullable().optional(),
});

// ── Station assignment (28-01 / 28-11) ────────────────────────────────────────────────────

/**
 * Mirrors `BranchDtos.StationAssignment` — a user's active station codes at one branch.
 *
 * <p>A branch with no assignment simply does not appear in the array. There is no empty-list
 * spelling of "unrestricted" and never will be: 28-01 states plainly that an empty list is NEVER
 * PRODUCED, and a consumer that sees one is looking at a bug upstream rather than at a scope.
 */
export const apiStationAssignmentSchema = z.object({
  branchId: z.string().uuid(),
  stationCodes: z.array(z.string()),
});

export type ApiStationAssignment = z.infer<typeof apiStationAssignmentSchema>;

/**
 * Mirrors `BranchDtos.StationAssignmentRequest`. Validated on the way OUT as well as in: the
 * request states what the user's stations now ARE at that branch, and a malformed one would
 * either widen or clear a scope silently.
 */
export const apiReplaceStationsRequestSchema = z.object({
  branchId: z.string().uuid(),
  stationCodes: z.array(z.string()),
});

// ── Menu-category assignment (Program A) ──────────────────────────────────────────────────

/**
 * Mirrors `BranchDtos.MenuCategoryAssignment` — the categories a user may ring at one branch.
 *
 * <p>Same absence rule as the station schema above, and it matters more here: a branch with no
 * assignment does not appear, and `categoryIds` is never returned empty. "No rows" means the user
 * rings the WHOLE menu — the state every user in the product is in today. A consumer that reads an
 * empty array as "may sell nothing" would render the universal default as a lockout.
 *
 * <p>`uuid()` on the ids rather than a bare string, unlike station CODES which are operator-typed
 * free text. Category ids are server-minted UUIDs with one spelling; anything else on this wire is
 * a bug worth failing on rather than rendering as an unmatchable checkbox.
 */
export const apiMenuCategoryAssignmentSchema = z.object({
  branchId: z.string().uuid(),
  categoryIds: z.array(z.string().uuid()),
});

export type ApiMenuCategoryAssignment = z.infer<typeof apiMenuCategoryAssignmentSchema>;

/**
 * Mirrors `BranchDtos.MenuCategoryAssignmentRequest`. Validated on the way OUT for the same reason
 * the station request is: this body states what the user's categories now ARE, so a malformed one
 * silently widens a scope to the whole menu or narrows it to a section nobody meant.
 */
export const apiReplaceMenuCategoriesRequestSchema = z.object({
  branchId: z.string().uuid(),
  categoryIds: z.array(z.string().uuid()),
});
