import { readFileSync } from "node:fs";

/**
 * The seeded persona catalog.
 *
 * SINGLE SOURCE OF TRUTH is `scripts/seed_restaurantos.py`. Every value below is derived
 * the same way that script derives it, so a change there is a compile-visible change here
 * rather than a silent drift:
 *
 *   email    = `${local}@${tenantKey}.local`                    (persona_email,    L204-205)
 *   password = `${Capitalise(tenantKey)}#${Capitalise(local)}1`  (persona_password, L208-216)
 *   tenants  = saffron / zaitoon / marina                        (TENANTS,          L130-172)
 *   roles    = owner|manager|cashier|waiter|kitchen|accountant   (PERSONAS,         L188-202)
 *
 * The tenant SLUG is deliberately NOT hard-coded. It is minted by platform-admin-service
 * from the brand name at provisioning time and is not the persona's email domain
 * ("Saffron Grill" → `saffron-grill`, while the persona is `owner@saffron.local`). The
 * setup project resolves it from the live platform API and writes `e2e/.auth/tenants.json`;
 * everything downstream reads that. Hard-coding it would let a re-provisioned tenant
 * silently point the whole suite at nothing.
 */

export type PersonaLocal = "owner" | "manager" | "cashier" | "waiter" | "kitchen" | "accountant";

/**
 * RETARGETED 2026-08-21 from saffron/zaitoon/marina to the tenants the seeder
 * actually creates.
 *
 * seed_restaurantos.py dropped the other three deliberately — its own comment
 * says "the user asked for the other tenants to be dropped" — but these fixtures
 * were never updated, so auth.setup.ts failed every run with "seeded tenants are
 * absent from the platform API" and the whole journeys suite was unrunnable.
 * The seeder is the source of truth; these follow it.
 *
 * Everything else derives from the key (email `${local}@${key}.local`, password
 * `${Key}#${Local}1`), so this rename is the whole change.
 */
export type TenantKey = "terrace";

export interface TenantSpec {
  key: TenantKey;
  /** brandName as provisioned — the join key against GET /api/v1/platform/tenants. */
  brand: string;
  tier: "STARTER" | "GROWTH" | "ENTERPRISE";
  /**
   * Feature divergence the seed deliberately creates so gating is exercised rather than
   * assumed (seed_restaurantos.py L124-172). Verified live 2026-08-07 against
   * GET /api/v1/feature-flags.
   */
  expectFeatures: { on: string[]; off: string[] };
}

export const TENANTS: Record<TenantKey, TenantSpec> = {
  terrace: {
    key: "terrace",
    brand: "Floating Terrace",
    tier: "ENTERPRISE",
    // Measured live 2026-08-21 from the seeder's own output: ENTERPRISE enables
    // 20 features on this tenant.
    expectFeatures: {
      on: [
        "FEATURE_POS",
        "FEATURE_CRM",
        "FEATURE_ANALYTICS",
        "FEATURE_NLQ",
        "FEATURE_MULTI_BRANCH",
        "FEATURE_REPORTING_ADVANCED",
      ],
      off: [],
    },
  },
};

export interface Persona {
  /** Stable id used for the storage-state filename and as the fixture key. */
  id: string;
  tenantKey: TenantKey;
  local: PersonaLocal;
  email: string;
  password: string;
  role: string;
  /**
   * True when the seed enrolled a second factor for this account, so a password-only
   * login is refused 401 TOTP_REQUIRED. Verified live 2026-08-07: owner and accountant
   * are enrolled; manager/cashier/waiter/kitchen are not.
   *
   * Driven by auth-service's `requiresTotpStepUp`, which fires on permissions OWNER and
   * ACCOUNTANT hold (finance.period.close, hr.payroll.approve) — D-29a.
   */
  totpEnrolled: boolean;
}

const ROLE_BY_LOCAL: Record<PersonaLocal, string> = {
  owner: "OWNER",
  manager: "MANAGER",
  cashier: "CASHIER",
  waiter: "WAITER",
  kitchen: "KITCHEN_STAFF",
  accountant: "ACCOUNTANT",
};

/**
 * The dashboard PRESET each persona's role resolves to.
 *
 * <p>Mirrors `resolveDashboardPreset(roles, permissions)` (`components/dashboard/presets.ts`),
 * which branches on ROLE first and only falls through to permissions for a role it does not
 * know. All six locals below hit a named branch, so this table is a total function of the role
 * and never depends on the permission fallback.
 *
 * <h3>Why this exists — the assertion it replaces</h3>
 *
 * <p>Specs used to prove "the shell rendered with a session" with
 * `getByRole("heading", { level: 1, name: "Dashboard" })`. There has been no `<h1>Dashboard</h1>`
 * in this product since the role-preset dashboards shipped: the `<h1>` is `preset.question`, so
 * an OWNER's reads "Is the business healthy?" and a KITCHEN_STAFF's "What is on the pass?"
 * (`dashboard-shell.tsx:133-135`, and identically at `:37` on `origin/main`, which is what dev
 * runs — so this is not a not-yet-deployed change). Six persona journeys, an axe scan and a
 * known-defect probe were all waiting 20-30s for a heading that cannot exist, and everything
 * downstream of that wait — including the 403 assertion that was the point of the defect probe —
 * never executed.
 *
 * <p>Asserting `data-preset` instead is STRICTLY STRONGER than the string it replaces, which is
 * the reason to prefer it over simply retyping the new copy. `<h1>Dashboard</h1>` proved only
 * that a heading existed; `data-preset` proves the session resolved, the token's ROLE was read,
 * and the role-correct dashboard was selected — a cashier served the owner's dashboard now
 * fails, where before it passed. It is also copy-independent, so editing a question is not a
 * test failure. Present on both the deployed and the local build
 * (`dashboard-shell.tsx:128` / `origin/main:33`) alongside `data-testid="dashboard"`.
 */
export const DASHBOARD_PRESET_BY_LOCAL: Record<PersonaLocal, string> = {
  owner: "owner",
  manager: "manager",
  cashier: "cashier",
  waiter: "waiter",
  kitchen: "kitchen",
  accountant: "accountant",
};

/** Enrolled at creation because their role holds a step-up-gated permission (D-29a). */
const TOTP_ENROLLED_LOCALS: ReadonlySet<PersonaLocal> = new Set<PersonaLocal>([
  "owner",
  "accountant",
]);

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function persona(tenantKey: TenantKey, local: PersonaLocal): Persona {
  return {
    id: `${tenantKey}.${local}`,
    tenantKey,
    local,
    email: `${local}@${tenantKey}.local`,
    password: `${capitalise(tenantKey)}#${capitalise(local)}1`,
    role: ROLE_BY_LOCAL[local],
    totpEnrolled: TOTP_ENROLLED_LOCALS.has(local),
  };
}

export const PERSONA_LOCALS: PersonaLocal[] = [
  "owner",
  "manager",
  "cashier",
  "waiter",
  "kitchen",
  "accountant",
];

// ONE tenant. The product owner confirmed 2026-08-21 that Floating Terrace alone
// is the demo. The old three-tenant fixture (saffron/zaitoon/marina) had already
// diverged from the seeder, which dropped them; keeping a second tenant here only
// re-created that drift, and Control Bistro's owner is not provisioned.
export const TENANT_KEYS: TenantKey[] = ["terrace"];

/** All 18 tenant personas, in a deterministic order. */
export const ALL_PERSONAS: Persona[] = TENANT_KEYS.flatMap((t) =>
  PERSONA_LOCALS.map((l) => persona(t, l)),
);

/**
 * The SuperAdmin. NOT a tenant persona: it authenticates against
 * POST /api/v1/platform/auth/login (platform-admin-service), gets a `token_type: platform`
 * JWT with no tenant_id, and lives under /platform/** in the UI — a different route group,
 * a different login route, a different rate-limit bucket.
 *
 * Created by 13-05's Liquibase migration, not by the seed script
 * (services/platform-admin-service/.../901-seed-project-superadmin.xml).
 */
export const SUPERADMIN = {
  id: "platform.superadmin",
  email: "superadmin@softxlogic.com",
  password: "Test@123!",
} as const;

/** Where the setup project writes per-persona storage state and the resolved tenant manifest. */
export const AUTH_DIR = "e2e/.auth";

export function storageStatePath(personaId: string): string {
  return `${AUTH_DIR}/${personaId}.json`;
}

export const TENANT_MANIFEST_PATH = `${AUTH_DIR}/tenants.json`;

/**
 * The branch a persona's session is scoped to, read from the `__meta` the setup project
 * wrote into its storage state (which took it from the live token's `branch_id` claim).
 *
 * Needed because several pos-service endpoints require an explicit `branchId` QUERY
 * PARAMETER even though the token already carries the claim — e.g.
 * `GET /api/v1/pos/orders/{id}` returns 400 without it (measured 2026-08-07;
 * lib/repositories/pos.repository.ts:200-203 passes it for exactly this reason).
 * Hard-coding a branch id would break the moment a tenant is re-provisioned.
 */
export function personaBranchId(personaId: string): string {
  // Deliberately a require-time read rather than a cached module constant: storage states
  // are minted per run, and a stale cache would silently point at a previous run's branch.
  const raw = readFileSync(storageStatePath(personaId), "utf8");
  const meta = (JSON.parse(raw) as { __meta?: { branchId?: string } }).__meta;
  if (!meta?.branchId) {
    throw new Error(
      `No branch_id in the storage state for ${personaId}. Re-run the auth-setup project — ` +
        "states are minted, not committed.",
    );
  }
  return meta.branchId;
}

export interface TenantManifest {
  generatedAt: string;
  /** tenantKey → { slug, tenantId } resolved from the live platform API. */
  tenants: Record<string, { slug: string; tenantId: string; tier: string }>;
}
