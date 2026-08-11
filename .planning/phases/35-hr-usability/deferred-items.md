## RlsForcedInvariantIT#configurationTablesAreEmptyAfterMigration is order-dependent (found 35-06)

The test asserts departments/designations/salary_components/employee_salary_components hold zero
rows "after migration". Failsafe shares ONE Postgres container across every IT class in the JVM, and
`HrConfigListsIT` and `EmployeeLookupMigrationIT` create departments. Whether it passes depends on
which class failsafe happens to run first — adding `TaxConfigIT` in 35-06 changed that order and the
assertion started reporting 14 departments and 2 designations.

Not caused by 35-06's code; exposed by 35-06's new test class. The invariant it asserts (nothing is
seeded by a migration) is worth keeping. The fix is to assert it against a pristine schema — a
migration-time snapshot, a dedicated container, or a check run before any other class writes — not
to relax the assertion. Owner: 35-02's file.

## attendance_quarantine lost FORCE ROW LEVEL SECURITY (not phase 35)

`RlsForcedInvariantIT#everyRlsEnabledTableIsForced` reports it. The owning agent's own changelog
`035-restore-force-rls-attendance-quarantine.xml` documents that they dropped FORCE in 034 for a
backfill and did not restore it. They are fixing it. Recorded here only so a later reader does not
attribute the red to phase 35.

## EVERY dialog in the product renders as a ~30px column (found 35-10, NOT caused by it)

Measured in Chromium at 1440px against the running dev server, `components/ui/dialog.tsx`
`DialogContent`:

| Dialog | computed `width` | computed `max-width` |
|---|---|---|
| Users → new user (untouched by phase 35) | 32px | 24px |
| HR → new employee (phase 35) | 48px | 48px |

`position: fixed`, parent is `BODY` at 1440px, **no** transform/filter/backdrop-filter ancestor
(checked explicitly — the DESIGN-BRIEF appendix hazard is not the cause). The class string is
`... grid w-full max-w-[calc(100%-2rem)] ... sm:max-w-sm`. A probe `<div>` appended to `document.body`
with `max-w-[calc(100%-2rem)] sm:max-w-2xl w-full` computed `max-width: none` on one run and `48px`
on another — the same class, two answers, in one session — which points at the utility not being
generated consistently rather than at a cascade conflict. No matching CSS rule with a
width/max-width declaration could be found by walking `document.styleSheets` against the element.

**Attempted and reverted:** rewriting the arbitrary value with Tailwind's underscore-for-space
escape (`max-w-[calc(100%_-_2rem)]`) changed nothing — still 48px. The change was reverted rather
than left in a shared component on a hypothesis that measurement had already disproved.

It reproduces on a dialog phase 35 never wrote, so it is pre-existing and app-wide. It is severe:
every form dialog in the product is a column of wrapped text with its buttons stacked. Owner: the
design-system phase (34/38). The `/app/users` reproduction is the cheapest one to iterate on.

Note for whoever picks it up: the FUNCTION of the phase-35 dialogs is verified correct despite this
— see `.planning/phases/35-hr-usability/evidence/`. Labels, selects, live validation and
field-bound server errors all behave; only the box they sit in is the wrong size.

## The running OPA container served a stale policy bundle (found 35-11, fixed by restart)

Everything 35-03, 35-05 and 35-06 built was unreachable at runtime and the symptom named the wrong
thing. `GET /api/v1/hr/config/departments` as the tenant OWNER answered:

    403 PERMISSION_DENIED — "Not permitted: hr.config_view"

The permission rows WERE in `auth_db` (`hr.config.view` / `hr.config.manage`, granted to
OWNER/TENANT_ADMIN/MANAGER/ACCOUNTANT, changeset `auth-1.0.0-046-hr-config-permissions` applied) and
the owner's freshly minted JWT DID carry both codes — verified by decoding it. The denial came from
OPA: `restaurantos-opa` bind-mounts `policies/` read-only and had been running since before 35-03
added the `config_view` / `config_manage` rules to `hr.rego`. An undefined rule evaluates to deny, so
a correct token was refused by a policy that did not yet know the rule existed.

`docker restart restaurantos-opa` fixed it; both endpoints answered immediately afterwards. Recorded
because the error message points at a permission code that is present and correct, which is a long
way from "the policy container has not been restarted since the rule was written". Anyone adding a
rego rule in this project must restart OPA before testing against the running stack — nothing does
it automatically, and no test catches it because `HrTestBase` starts a fresh OPA container per run.
