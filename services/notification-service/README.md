# notification-service — INTENTIONAL PLACEHOLDER (no implementation)

**This module contains no source code and produces no artifact. That is deliberate, not an oversight.**

## Status

| | |
|---|---|
| Source files | none (`src/main/java` does not exist) |
| Maven packaging | `pom` — deliberately **not** `jar`; the module builds no artifact |
| In the reactor | yes (module 21 of the root `pom.xml`) |
| In the CI image matrix | **no** — there is nothing to containerise |
| Decision of record | Phase 13, D-31 — email delivery declared out of scope |

## Why it still exists in the reactor

Removing the module from the root `pom.xml` would silently drop the reserved
service name and coordinates, and would break every service `Dockerfile` that
copies the full reactor POM list before building (they all `COPY
services/notification-service/pom.xml`, and Maven validates every declared
`<module>` even under `-pl`/`-am`). Keeping the module is the cheaper, more
honest option — provided it does not pretend to be a deployable service.

## Why packaging is `pom` and not `jar`

Under `jar` packaging Maven ran `maven-jar-plugin` against an empty classes
directory on every single build. Two bad consequences:

1. `[WARNING] JAR will be empty - no content was marked for inclusion!` on every
   build, training everyone to ignore build warnings.
2. It installed a ~1.5 KB `notification-service-1.0.0.jar` into `target/` and the
   local repository — an artifact that looks deployable, is named like a running
   service, and does nothing.

`pom` packaging is Maven's standard way to declare "this module intentionally
produces no artifact". No empty jar, no warning, no false signal.

## What this service is meant to consume

When it is implemented, it is the missing consumer of the password-reset flow:

- **Exchange / topic:** `auth.topic`
- **Routing key:** `auth.user.password_reset_requested`
- **Producer:** `services/auth-service/.../service/PasswordResetService.java`
  (`PasswordResetService#issueResetToken` publishes the event)
- **Payload:** `shared-lib/.../event/payload/PasswordResetRequestedPayload`

With no consumer bound to that routing key, the self-service *forgot password*
flow is end-to-end dead: the event is published and nothing ever delivers an
email.

## Known gap / recovery path

The decision to leave this unimplemented is recorded in
`.planning/phases/13-platform-tenant-access-repair/13-09-PLAN.md` (decision
record "Resolved: the notification-service question (D-31)") and indexed as D-31
in `13-DECISION-MAP.md`.

The canonical reference for this gap is
**[`Docs/known-gaps/notification-delivery.md`](../../Docs/known-gaps/notification-delivery.md)**,
written by plan 13-09. Read it before writing anything in this module: it records
what the reset event now carries, what a consumer must do to obtain the token
over an internal channel, and why the token must never be put back into the
event. (The plan named the path in lower case; the repository's documentation
directory is `Docs`, and the file is there.)

Since 13-09, auth-service ships with self-service reset **disabled by default**
(`restaurantos.auth.password-reset.delivery-mode`) and logs a `WARN` at startup
saying so, rather than minting a live credential for a message this module will
never send. Turning it to `outbox` is the first step of implementing this
consumer, and it should not be turned on before one exists.

Supported password-recovery paths in the meantime (per D-31):

- administrator-initiated reset (plan 13-13)
- self-service password *change* for a user who can still log in (plan 13-04)

Self-service forgot-password is **unavailable**.

## Explicitly not wanted

Do **not** add a stub consumer that accepts the message and drops or merely logs
it. Plan 13-09 rules this out by name: a fake consumer is strictly worse than an
absent one, because it makes a dead flow look alive.

## When implementing for real

1. Flip `<packaging>` back to `jar`.
2. Restore the `<argLine/>` property and the surefire/failsafe wiring used by the
   sibling services (see `services/audit-service/pom.xml`).
3. Add a `coverage` profile with the JaCoCo plugin — `.github/workflows/coverage-gates.json`
   will gate the module at the `java.default` threshold the moment it emits a report.
4. Add a `Dockerfile` and a matching entry in the `build` job matrix of
   `.github/workflows/ci.yml`.
