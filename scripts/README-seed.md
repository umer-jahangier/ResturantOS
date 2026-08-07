# `scripts/seed_restaurantos.py` — how the seed works, and how to trust it

> **Credentials live in one place and it is not this file.** See **[`scripts/CREDENTIALS.md`](CREDENTIALS.md)**
> for every login, TOTP secret and tenant slug. Two documents listing the same passwords is how
> the pair drifts and one of them starts lying, which is the exact failure this phase exists to
> close. This file is about the mechanism.

> ### ⚠️ Everything the seed creates is DEVELOPMENT-ONLY
> The passwords are in git. Rotate all of them before anything is deployed or made
> internet-reachable. The script **refuses to run** unless the gateway origin is `localhost`,
> `127.0.0.1` or explicitly allow-listed via `SEED_ALLOWED_HOSTS`; that is a backstop, not
> permission.

---

## Running it

```bash
python3 scripts/seed_restaurantos.py                     # every phase
python3 scripts/seed_restaurantos.py --phase platform    # tenants + module sets
python3 scripts/seed_restaurantos.py --phase personas    # the accounts
python3 scripts/seed_restaurantos.py --phase business    # menu, inventory, purchasing, POS
python3 scripts/seed_restaurantos.py --phase verify      # THE ACCEPTANCE TEST

.\scripts\seed_restaurantos.ps1                          # Windows; a launcher, not a second
                                                         # implementation
```

**Requires:** Python 3 (standard library only — installing a package to make a verification
script run is forbidden by this phase's threat register), Docker (only for the recovery paths and
`--corrupt-persona`, which reach the database through `docker exec restaurantos-postgres psql`),
and a running dev stack: gateway, auth, user, platform-admin, pos, inventory, purchasing, finance
and reporting.

---

## The four phases

| Phase | What it does | Driven by |
|---|---|---|
| `platform` | verifies the SuperAdmin **by logging in**, provisions the tenants, sets tiers, applies the deliberate feature overrides, and **asserts the enabled module sets differ** | `SUPER_ADMIN` |
| `personas` | reads the role catalog, creates every account through the public user API, walks each one through the real forced-change flow, and enrols a second factor for every account the platform challenges | the tenant `OWNER` |
| `business` | menu and categories, units of measure, ingredients and a recipe, vendor → PO → goods receipt → invoice, and point-of-sale orders taken by a waiter and settled by a cashier | **the role that owns each surface**, never the owner for everything |
| `verify` | authenticates **every** seeded principal through the real gateway and exits non-zero naming each failure | each persona, as itself |

---

## Why the SuperAdmin is never created here

`superadmin@softxlogic.com` is owned by a **migration**. The seed verifies it by logging in and
fails immediately naming that migration if the login is refused. A seeder that silently re-creates
what a migration owns is how two sources of truth appear, and then how they diverge.

---

## Idempotency

Every identifier the script controls is a `uuid5` over a stable name, in the same namespace
`scripts/onboarding.py` uses. Resources whose identifier the **server** assigns — tenants, users —
are looked up first and reconciled rather than duplicated.

**Every one of those names is scoped to the tenant ID, not to a tenant key**, and that is not
decoration. `OrderServiceImpl.createOrder` is idempotent on `clientOrderId` and
`findByClientOrderId` carries no tenant predicate, so a client order id derived from a stable key
is answered by whichever tenant used it first — including one that has since been deleted. That
was measured, not theorised: a freshly provisioned tenant was handed back a previous tenant's
order and every read of it then 404'd. See "the leak" below.

Three consecutive runs produce identical counts and change nothing material.

---

## Step-up: which accounts are challenged, and why it is not a bug

`AuthServiceImpl.requiresTotpStepUp` challenges a login when the resolved permission set contains
`rbac.manage`, `finance.period.close` or `hr.payroll.approve` — **or when the account already has
a factor enrolled**.

- `OWNER` holds `rbac.manage` and both money codes.
- `TENANT_ADMIN` does **not** hold `rbac.manage` — 13-02 split user and branch administration off
  it deliberately — but it does hold `finance.period.close` and `hr.payroll.approve`, so it is
  still challenged. That is **D-29a**, taken during execution: revoking those two codes would
  leave tenant admins unable to run payroll or close a period at all, so the step-up stays and
  enrolment became part of account creation instead.
- `ACCOUNTANT` holds `finance.period.close`. It is not an administrator, and it is challenged
  anyway, because the gate is on the **action** and not on seniority.
- `MANAGER`, `CASHIER`, `WAITER`, `KITCHEN_STAFF` and `INVENTORY_MANAGER` hold none of them and
  are never challenged.

The order of operations is fixed and not negotiable:

```
1. forced password change     (so the factor is never bound under a temporary credential
2. TOTP bootstrap + verify     that whoever provisioned the account also knows)
3. login with a code
```

Secrets are written to `.seed-state/totp/<email>` (gitignored, mode 600). They are minted by
auth-service and **cannot be re-derived**. Losing that directory is recoverable — the script
clears the factor and re-enrols — but the clear is a direct database write and is printed in the
ledger, because no endpoint at any tier revokes another user's second factor.

---

## Direct database writes

The ledger prints on **every run**, and on the normal path it reads *NONE*. Three writes exist and
none is on the happy path:

| Write | Table | Why no API covers it |
|---|---|---|
| clear an enrolled TOTP factor | `auth_db.users.totp_secret` | **recovery only.** No endpoint at any tier resets another user's second factor. 13-13's administrator reset deliberately leaves TOTP intact, and is right to — a password reset replaces one factor, not both. |
| delete password history | `auth_db.password_history` | **recovery only.** `PasswordPolicyService.HISTORY_DEPTH` is 5, so an account that has already held its documented password cannot be returned to it. Nothing can rescind history and nothing should: the rule is a control on *human* password choice. |
| replace a password hash with an unusable value | `auth_db.users.password_hash` | **`--corrupt-persona` only.** Deliberate fault injection — see below. |

Everything else goes through the public API at the gateway: provisioning, tier changes, feature
toggles, user creation, branch-role assignment, branch creation, forced password change, TOTP
enrolment, menu, units of measure, ingredients, recipes, vendors, purchase orders, goods receipt,
vendor invoices, till opening, order creation, KDS dispatch, serving and settlement.

**No business date is faked.** Vendor invoices are dated across several days through `invoiceDate`,
a real request field. Point-of-sale orders land on the current business date and are **not**
back-dated: `BusinessDay.of(closedAt)` derives it from the wall-clock close, no endpoint accepts an
override, and `business_date` is part of the ClickHouse fact tables' `ORDER BY` and partition key,
so it cannot be mutated afterwards either. A report over the last thirty days is non-empty; a
report over an unseeded month is empty, and that is stated rather than papered over.

---

## The verification loop is the acceptance test

`--phase verify` authenticates every seeded principal through the real gateway. For each it
asserts **three** things, not one:

1. the login succeeds;
2. the returned token carries the **expected role** and a **non-empty** permission list;
3. one endpoint gated on a permission **only that role holds** answers 200 — not merely "not 403".

| Role | Gate | Endpoint |
|---|---|---|
| `SUPER_ADMIN` | `SUPER_ADMIN` | `GET /api/v1/platform/tenants` |
| `OWNER` / `TENANT_ADMIN` | `rbac.manage` \| `rbac.user.manage` | `GET /api/v1/users` |
| `MANAGER` | `pos.menu.manage` | `GET /api/v1/pos/menu/categories/admin` |
| `CASHIER` | `pos.till.open` | `GET /api/v1/pos/tills` |
| `WAITER` | `pos.order.view` | `GET /api/v1/pos/tables?branchId=…` |
| `KITCHEN_STAFF` | `pos.kds.view` | `GET /api/v1/pos/stations?branchId=…` — its only reachable POS read |
| `ACCOUNTANT` | `finance.coa.view` | `GET /api/v1/finance/accounts` |
| `INVENTORY_MANAGER` | `inventory.item.view` | `GET /api/v1/inventory/ingredients` |

**It never inspects the database for expected rows.** A row is what a broken API leaves behind too.

### Prove it can fail before you trust it passing

```bash
python3 scripts/seed_restaurantos.py --corrupt-persona cashier@terrace.local
python3 scripts/seed_restaurantos.py --phase verify     # exits 1 and names that address, only
python3 scripts/seed_restaurantos.py --phase personas   # repairs it through the real reset API
```

The repair uses `POST /api/v1/users/{userId}/reset-password` — 13-13's endpoint, and the **only**
working way to set a user's password now that self-service delivery ships disabled (13-09 / D-31:
`notification-service` has zero source files, so no email can be sent). The recovery path is
itself a live exercise of a repaired API.

---

## The leak the seed works around, and does not hide

`GET /api/v1/pos/menu/items/admin`, `.../categories/admin` and `GET /api/v1/purchasing/vendors`
return **every tenant's rows**. `pos_db.menu_items`, `pos_db.menu_categories`, `pos_db.orders`,
`purchasing_db.vendors`, `purchasing_db.purchase_orders` and `purchasing_db.vendor_invoices` are
all `relrowsecurity = true` with `relforcerowsecurity = FALSE`, and both services connect as the
role that **owns** those tables — PostgreSQL exempts a table's owner from its own policies unless
`FORCE` is set. The queries carry no tenant predicate of their own either.

The seed is immune: every reconciliation key is a marker containing the tenant id, so a
neighbour's row can never be adopted. **The platform is not immune.** It is recorded as item 9 in
`.planning/phases/13-platform-tenant-access-repair/deferred-items.md` with the exact remedy, and
in `13-E2E-EVIDENCE.md` §5 with the live evidence.

---

## When it fails

| Symptom | Almost always |
|---|---|
| `502 UPSTREAM_ERROR` on the platform login | **auth-service is down.** platform-admin delegates token minting to it. |
| `503 SERVICE_UNAVAILABLE` on anything | a **wedged service** — `/actuator/health` answers in milliseconds while every other path hangs. Probe a real path on the service's own port, not `/actuator/health`, then restart it. Seen on finance, pos, hr and inventory in this phase alone. |
| `429` | the gateway's per-IP auth budget (2/s, burst 100) needs ~50s of quiet to refill. The script already retries with backoff and never reports a 429 as a failure; a bare `curl` will not. |
| `409 NO_OPEN_TILL` on a cash settlement | correct behaviour (D-30). The settling cashier must hold an OPEN till. A card tender needs none. |
| `409 TOTP_ALREADY_ENROLLED` | the account holds a factor this run has no secret for. The script clears and re-enrols it, and prints that write in the ledger. |

---

## The one command a reviewer runs

```bash
bash scripts/e2e/phase13-acceptance.sh
```

Every phase 13 end-to-end script, then this seed in full, one aggregate result. It carries each
suite's baseline PASS count so a suite that quietly *stops asserting things* is visible, and it
retries a red suite once and **reports the retry** rather than hiding it.
