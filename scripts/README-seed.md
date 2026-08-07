# RestaurantOS seed — the credential inventory

> ## ⚠️ DEVELOPMENT CREDENTIALS ONLY
>
> **Every password on this page is public.** It is in a git repository, it is in the seed script,
> and anyone who can read this file can log into any account it names. These credentials exist so
> a developer can reach a realistic environment in one command, and for no other reason.
>
> **Rotate every one of them before any deployment, and never provision a shared or internet-
> reachable environment with this script.** `scripts/seed_restaurantos.py` refuses to run against
> a gateway origin that is not `localhost`, `127.0.0.1` or explicitly allow-listed; that guard is
> the last line of defence, not a licence to point it at something real.
>
> The seed script itself **never prints a password or a token** — it prints principal identifiers
> and outcomes. This file is the single place any of them is written down.

---

## Running it

```bash
# macOS / Linux
python3 scripts/seed_restaurantos.py                     # every phase
python3 scripts/seed_restaurantos.py --phase platform    # tenants and module sets
python3 scripts/seed_restaurantos.py --phase personas    # the eighteen personas
python3 scripts/seed_restaurantos.py --phase business    # menu, inventory, purchasing, POS
python3 scripts/seed_restaurantos.py --phase verify      # the acceptance test

# Windows
.\scripts\seed_restaurantos.ps1
```

It is **idempotent**: a second run reconciles rather than duplicates, and changes nothing
material. Identifiers the script controls are `uuid5` over a stable name in the same namespace
`scripts/onboarding.py` uses; resources whose identifier the server assigns are looked up first.

Requires a running dev stack (`scripts/start-dev.sh`) with, at minimum, **gateway, auth-service,
user-service, platform-admin-service, pos-service, inventory-service, purchasing-service,
finance-service and reporting-service**. `python3` and `docker` are the only host dependencies;
everything the script imports is standard library.

State lives in `.seed-state/` (gitignored): **server-minted TOTP secrets**, which are not
derivable and which the personas holding a second factor cannot log in without. Losing that
directory is recoverable — the script clears and re-enrols the factor, and says so — but it is
one of only two places it ever writes to a database directly.

---

## The SuperAdmin

| | |
|---|---|
| **Email** | `superadmin@softxlogic.com` |
| **Password** | `Test@123!` |
| **Login** | `POST /api/v1/platform/auth/login` (no tenant slug — a platform user is tenant-less) |
| **Reaches** | `/api/v1/platform/**` |
| **Step-up** | none. `platform_users` has no TOTP column; that is a known gap, listed in 13-CONTEXT's deferred items |
| **Owned by** | a **migration**, not this script. The seeder VERIFIES it by logging in and fails naming the migration if that login is refused — a seeder that silently re-creates what a migration owns is how two sources of truth appear |

The previously seeded `superadmin@restaurantos.io`, whose password was committed in
`900-seed-platform-users.xml`, is retired by plan 13-05 and must not be usable in a shippable
configuration.

> **`Test@123!` is nine characters and satisfies the policy** — shared-lib's `@StrongPassword`
> requires at least eight with a lowercase letter, an uppercase letter, a digit and a special
> character. Do not "harden" it by raising the floor; a test pins this value.

---

## The three tenants

Their enabled module sets are **deliberately different**, and the script asserts they are pairwise
different rather than trusting that the calls succeeded. Tier alone would leave the three nested;
the two overrides make them genuinely incomparable, which is what exercises feature gating instead
of assuming it.

| Tenant | Slug | Tier | Enabled | Deliberate divergence |
|---|---|---|---|---|
| Saffron Grill | `saffron-grill` | **STARTER** | 10 features | `FEATURE_NLQ` forced **ON** — a GROWTH+ feature a STARTER tenant can only hold as an override |
| Zaitoon Kitchen | `zaitoon-kitchen` | **GROWTH** | 17 features | `FEATURE_CRM` forced **OFF** — a primary module that is ON in every tier by default |
| Marina Bay Dining | `marina-bay-dining` | **ENTERPRISE** | 20 features | none; the full tier default |

Both overrides are written through `PATCH /api/v1/platform/tenants/{id}/features/{code}`, so both
rows carry `is_override = true` and survive a tier change in either direction (13-14).

**Branches.** Every tenant gets an HQ branch from the provisioning saga. `zaitoon-kitchen` gets a
second branch, `Zaitoon Kitchen Clifton`, created through `POST /api/v1/branches`, and its manager
holds `MANAGER` at **both** — so 13-02's one-active-role-per-branch rule is exercised across two
branches rather than assumed.

---

## The eighteen personas

Six per tenant. The password is `{Tenant}#{Role}1` — for example `Saffron#Owner1`. Every one is at
least twelve characters with all four required character classes.

Every persona below **completed a real forced password change** (13-08:
`403 PASSWORD_CHANGE_REQUIRED` → `POST /api/v1/auth/change-password/forced`) and holds the password
in this table. **No persona is left holding a temporary password.**

### Saffron Grill — slug `saffron-grill`

| Email | Password | Role | Step-up | Reaches |
|---|---|---|---|---|
| `owner@saffron.local` | `Saffron#Owner1` | `OWNER` | **TOTP required** | everything; 65 permissions |
| `manager@saffron.local` | `Saffron#Manager1` | `MANAGER` | no | menu, inventory, purchasing, POS, reports; 49 permissions |
| `cashier@saffron.local` | `Saffron#Cashier1` | `CASHIER` | no | till open/close, order close; 14 permissions |
| `waiter@saffron.local` | `Saffron#Waiter1` | `WAITER` | no | order create/update/send-to-KDS, **no till**; 7 permissions |
| `kitchen@saffron.local` | `Saffron#Kitchen1` | `KITCHEN_STAFF` | no | KDS view and update only; 2 permissions |
| `accountant@saffron.local` | `Saffron#Accountant1` | `ACCOUNTANT` | **TOTP required** | finance, vendor invoices, reports; 24 permissions |

### Zaitoon Kitchen — slug `zaitoon-kitchen`

| Email | Password | Role | Step-up | Notes |
|---|---|---|---|---|
| `owner@zaitoon.local` | `Zaitoon#Owner1` | `OWNER` | **TOTP required** | |
| `manager@zaitoon.local` | `Zaitoon#Manager1` | `MANAGER` | no | holds `MANAGER` at **both** branches |
| `cashier@zaitoon.local` | `Zaitoon#Cashier1` | `CASHIER` | no | |
| `waiter@zaitoon.local` | `Zaitoon#Waiter1` | `WAITER` | no | |
| `kitchen@zaitoon.local` | `Zaitoon#Kitchen1` | `KITCHEN_STAFF` | no | |
| `accountant@zaitoon.local` | `Zaitoon#Accountant1` | `ACCOUNTANT` | **TOTP required** | |

### Marina Bay Dining — slug `marina-bay-dining`

| Email | Password | Role | Step-up |
|---|---|---|---|
| `owner@marina.local` | `Marina#Owner1` | `OWNER` | **TOTP required** |
| `manager@marina.local` | `Marina#Manager1` | `MANAGER` | no |
| `cashier@marina.local` | `Marina#Cashier1` | `CASHIER` | no |
| `waiter@marina.local` | `Marina#Waiter1` | `WAITER` | no |
| `kitchen@marina.local` | `Marina#Kitchen1` | `KITCHEN_STAFF` | no |
| `accountant@marina.local` | `Marina#Accountant1` | `ACCOUNTANT` | **TOTP required** |

---

## Step-up: which personas need a second factor, and how to get a code

`AuthServiceImpl.requiresTotpStepUp` challenges a login when the resolved permission set contains
`rbac.manage`, `finance.period.close` or `hr.payroll.approve` — **or when the account already has
a factor enrolled.**

- `OWNER` holds all three.
- **`ACCOUNTANT` holds `finance.period.close`**, so it is challenged too. That surprises people:
  the accountant is not an administrator, but closing an accounting period is a money-moving
  action and the gate is on the action, not the seniority.
- `MANAGER`, `CASHIER`, `WAITER` and `KITCHEN_STAFF` hold none of them and are never challenged.

This is **D-29a**, taken during execution and superseding earlier plan text: rather than revoking
`finance.period.close` and `hr.payroll.approve` from tenant administrators — which would leave them
unable to run payroll or close a period at all — step-up stays and enrolment becomes part of
account creation. The seed therefore enrols a factor for every persona the platform challenges, in
this order and no other:

```
1. forced password change      (so the factor is never bound under a credential
2. TOTP bootstrap + verify      whoever provisioned the account also knows)
3. login with a code
```

**Getting a code for a manual login.** The secret is written to
`.seed-state/totp/<email>`. Either:

```bash
# from the secret the seed stored
python3 - "$(cat .seed-state/totp/owner@saffron.local)" <<'PY'
import base64, hmac, hashlib, struct, sys, time
s = sys.argv[1]
k = base64.b32decode(s + '=' * (-len(s) % 8), casefold=True)
m = hmac.new(k, struct.pack('>Q', int(time.time()) // 30), hashlib.sha1).digest()
o = m[-1] & 15
print(str((struct.unpack('>I', m[o:o+4])[0] & 0x7FFFFFFF) % 10**6).zfill(6))
PY

# or from the database, using the existing helper
python3 scripts/generate_totp.py owner@saffron.local --tenant-slug saffron-grill
```

Or add the secret to any authenticator app — the seed obtained it from the standard
`otpauth://` URI that `POST /api/v1/auth/2fa/bootstrap` returns.

**If `.seed-state/` is lost**, re-run `--phase personas`. There is **no endpoint at any tier that
resets another user's second factor** (13-13's administrator reset deliberately leaves TOTP
intact, and is right to — a password reset replaces one factor, not both), so the script clears
the factor directly and re-enrols it, printing that write in its ledger.

---

## Logging in by hand

```bash
# a persona with no step-up
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"waiter@saffron.local","password":"Saffron#Waiter1","tenantSlug":"saffron-grill"}'

# a persona that is challenged — add totpCode
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@saffron.local","password":"Saffron#Owner1","tenantSlug":"saffron-grill","totpCode":"123456"}'

# the SuperAdmin — no tenantSlug
curl -s -X POST http://localhost:8080/api/v1/platform/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"superadmin@softxlogic.com","password":"Test@123!"}'
```

---

## What business data each tenant gets

Driven through the real API by **the role whose permissions cover it** — a seeder that does
everything as the owner proves nothing about the other five roles.

| | saffron-grill | zaitoon-kitchen | marina-bay-dining | driven by |
|---|---|---|---|---|
| menu items | 4 | 5 | 6 | `MANAGER` (`pos.menu.manage`) |
| ingredients + a recipe | 3 + 1 | 3 + 1 | 3 + 1 | `MANAGER` (`inventory.item.manage`) |
| vendor invoices, PO → GRN → invoice | 1 | 2 | 3 | `MANAGER` (`vendor.*`) |
| settled POS orders | 3 | 5 | 7 | `WAITER` takes them, `CASHIER` settles |
| chart of accounts | seeded by provisioning | | | the saga |

**The point-of-sale flow is D-30 exactly as specified.** The waiter creates the order, adds lines,
fires it to the KDS and serves — holding **no till**, because a waiter cannot open one and that is
the whole point. The cashier settles it, and opens a till first because a **CASH** tender requires
the paying user to hold an OPEN till (`409 NO_OPEN_TILL` otherwise). Every third order is settled
by **CARD**, which needs no till, so the exemption is exercised too.

**Business dates.** Vendor invoices are dated across several days through `invoiceDate`, which is a
real request field — so period-scoped purchase reporting has more than one day in it with **no
back-dating and no direct write anywhere.** Point-of-sale orders land on the current business date:
`BusinessDay.of(closedAt)` derives it from the wall-clock close, no endpoint accepts an override,
and `business_date` is part of the ClickHouse fact tables' `ORDER BY` and partition key, so it
cannot be mutated afterwards either. A report over the last thirty days is non-empty; a report over
a month with no seeding in it is not, and that is stated rather than faked.

---

## Direct database writes

The script prints its ledger on **every run**, and on the normal path that ledger is **empty** —
everything goes through a real API at the gateway. Three writes exist, and none is on the happy
path:

| Write | Table | Why no API |
|---|---|---|
| clear an enrolled TOTP factor | `auth_db.users.totp_secret` | **recovery only.** No endpoint at any tier resets another user's second factor. The replacement would be an admin "revoke second factor" beside `POST /api/v1/users/{userId}/reset-password`, gated and audited the same way. |
| delete password history | `auth_db.password_history` | **recovery only.** `HISTORY_DEPTH` is 5, so a persona that has already held its documented password cannot be returned to it. Nothing can rescind history and nothing should — the rule is a control on *human* password choice, and this is a development seed converging on a documented credential. |
| replace a password hash with an unusable value | `auth_db.users.password_hash` | **`--corrupt-persona` only.** There is no API for breaking an account and there should not be. It exists so the verification loop can be shown to fail. |

---

## The verification loop is the acceptance test

`--phase verify` authenticates **all nineteen principals** — the SuperAdmin and the eighteen
personas — through the real gateway, asserts each token carries the expected role and a non-empty
permission list, calls one endpoint gated on a permission only that role holds among the six, and
exits **non-zero naming every failure**. It never inspects the database for expected rows: a row is
what a broken API leaves behind too.

| Persona | Gate | Endpoint |
|---|---|---|
| `OWNER` | `rbac.manage` | `GET /api/v1/users` |
| `MANAGER` | `pos.menu.manage` | `GET /api/v1/pos/menu/categories/admin` |
| `CASHIER` | `pos.till.open` | `GET /api/v1/pos/tills` |
| `WAITER` | `pos.order.view` | `GET /api/v1/pos/tables?branchId=…` |
| `KITCHEN_STAFF` | `pos.kds.view` | `GET /api/v1/pos/stations?branchId=…` — its only reachable POS read |
| `ACCOUNTANT` | `finance.coa.view` | `GET /api/v1/finance/accounts` |
| `SUPER_ADMIN` | `SUPER_ADMIN` | `GET /api/v1/platform/tenants` |

**Prove it can fail before you trust it passing:**

```bash
python3 scripts/seed_restaurantos.py --corrupt-persona cashier@saffron.local
python3 scripts/seed_restaurantos.py --phase verify     # exits 1, names cashier@saffron.local
python3 scripts/seed_restaurantos.py --phase personas   # repairs it through the real reset API
```
