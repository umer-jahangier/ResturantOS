# Phase 14b — deferred items

Discovered during 14b execution, deliberately NOT fixed here. Each is either outside the Tier 0
register scope or owned by a named later phase. Recorded so the next phase inherits evidence rather
than a rediscovery.

---

## D0 — `--muted-foreground` fails WCAG AA contrast across the product

**Found by** `e2e/journeys/accessibility-smoke.spec.ts` → axe, on `/app/dashboard`, `/app/reports`
and `/app/pos`. Reported as `serious: color-contrast`, and it flickers between runs — axe samples at
slightly different paint moments, so any given run flags a different subset of the same class:

```
<p class="text-muted-foreground">Overview for your branch — signed in as MANAGER.</p>
<div data-slot="card-description" class="text-sm text-muted-foreground">Closed sales</div>
<p class="text-xs text-muted-foreground">3 completed orders</p>
```

Every flagged node uses `text-muted-foreground`, on elements this phase did not author. This is one
token, not many bugs: `--muted-foreground` is too light against `--background` for small text at AA.

**Deliberately not fixed here.** Adjusting a design token is precisely what this phase's guardrails
forbid ("the design-system tokens landed in phase 20 — use them rather than introducing new
colours"), and changing `--muted-foreground` restyles every secondary line in the product. It wants
a token decision and a full visual pass, not a triage edit.

**Fixed in passing, and worth separating out:** the same spec was also reporting
`serious: aria-prohibited-attr` on `branch-switcher.tsx` — an `aria-label` on a role-less `<div>`,
which assistive technology discards entirely, so the loading region announced nothing. That one was
a genuine one-line defect of the same class as GA-059 and is now `role="status"`. It no longer
appears in any run.

**Owner:** Phase 20/22 (design system + screen rebuilds).

---

## D1 — POS "Polling" chip fails colour contrast (serious)

**Found by** `e2e/journeys/accessibility-smoke.spec.ts` → axe on `/app/pos`, during 14b regression
verification.

```
[serious] color-contrast — Elements must meet minimum color contrast ratio thresholds
  <span data-testid="pos-live-indicator" class="… text-xs font-medium text-amber-600"
        title="Polling — reconnecting">
```

**Why deferred, twice over.** First, it is a *symptom*: the chip only renders when the POS live-order
WebSocket has degraded to polling, which is **GA-017** — `JwtGlobalFilter:110-113` omits
`/api/v1/pos/ws/` from `WS_UPGRADE_PATHS`, so a browser WebSocket (which cannot set an
`Authorization` header) is refused and the `?token=` fallback never applies. Fix GA-017 and this
element stops rendering in the healthy case entirely. Second, `text-amber-600` on the card
background is a design-token decision owned by the design system (phase 20), and this phase's
guardrails forbid introducing new colours.

**Owner:** GA-017 → Phase 17 (Tier 1, 0.5d). Contrast token → Phase 20/22.

---

## D2 — `pos-waiter-to-kitchen` journey: kitchen ticket list 404s after a bump

**Found by** `e2e/journeys/pos-waiter-to-kitchen.spec.ts:204` — `expect(after.status()).toBe(200)`
received **404** re-reading the kitchen ticket list after the bump.

Unrelated to any 14b change: no file in this phase touches kitchen-service, its gateway route, or
the KDS repository. Present before this phase's first commit.

**Owner:** kitchen-service routing. Note the register's own caveat that POS coverage in the audit is
thinner than the rest, because one of the nine agents died mid-run.

---

## D3 — `auth-service` cannot be restarted without a manual ownership handoff

**Found while** restarting auth-service to pick up the GA-008 / GA-032 changes.

```
Migration failed for changeset 081-login-candidate-lookup.xml::…-function
Caused by: PSQLException: ERROR: must be owner of function auth_lookup_login_candidates
```

The changeset is `runOnChange="true"` and its body is a `CREATE OR REPLACE`. After
`deploy/scripts/verify-security-definer-owners.sh` hands the function to `postgres` (which it must —
`SECURITY DEFINER` has to bypass FORCE RLS on `users`, and `auth_user` is `NOBYPASSRLS`), the next
start-up re-runs the changeset **as `auth_user`**, which no longer owns the function, and the whole
service fails to boot. The changeset's own comment predicts the ownership trap but not this loop.

**Workaround used here** (documented so the next person does not lose an hour):

```bash
docker exec restaurantos-postgres psql -U postgres -d auth_db \
  -c "ALTER FUNCTION public.auth_lookup_login_candidates(TEXT) OWNER TO auth_user;"
# start auth-service, let the changeset re-apply, then:
bash deploy/scripts/verify-security-definer-owners.sh   # hands it back to postgres
```

**Real fix, not attempted here** (out of scope — infrastructure, not a Tier 0 UI defect): either drop
`runOnChange` now the body is stable, or make the changeset `ALTER FUNCTION … OWNER TO postgres` at
the end of its own SQL so it is self-healing rather than dependent on a post-migration script.

**Owner:** Phase 37 (scalability and operability) or the DEV-STACK runbook, whichever lands first.

---

## D4 — `scripts/onboarding.py` prints a database error and continues

Every run emits, before its success lines:

```
Database error: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

Tenants provision correctly regardless (verified: `ga008-verify`, `ga008-browser`,
`ga008-browser2` all authenticate). Some `ON CONFLICT` target lacks a matching constraint and the
script swallows the failure. Harmless today, but it means one upsert silently does nothing, and it
trains the reader to ignore a red line during onboarding — which is how GA-008 stayed invisible.

**Owner:** Phase 29 (guided tenant onboarding).

---

## D5 — No QR code on the TOTP enrolment screen

GA-008's flow is complete and verified end to end, but the enrolment step offers a manual setup key
and an `otpauth://` link rather than a scannable QR image, because no QR library exists in any
`package.json` (**GA-101**) and adding a dependency inside a triage phase is not a decision this
phase should make unilaterally.

Manual entry is the documented fallback of every major authenticator, and on a phone the
`otpauth://` link opens the app directly, so the deadlock is genuinely broken. The QR image is a
convenience upgrade over a working flow, not a missing half of one.

**Owner:** Phase 23, alongside GA-101.
