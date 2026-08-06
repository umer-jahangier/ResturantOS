# Known gap: there is no notification delivery, and self-service password reset is off

**Status:** open
**Opened:** 2026-08-07, phase 13 plan 09 (D-31)
**Owner:** unassigned — pick this up deliberately, it is not a leftover

## The fact

`services/notification-service` is an active Maven module in the reactor with **zero source files**.

```
services/notification-service/
├── pom.xml
└── README.md
```

Nothing consumes `PASSWORD_RESET_REQUESTED`. Nothing consumes any invite event. **Every email path in
this platform is dead**, and has been since the module was created.

## What that meant before 13-09, and why it was worse than "no email"

`POST /api/v1/auth/reset-password/request` answered `200`, minted a live single-use credential,
wrote an event nobody read, and returned a body indistinguishable from success. A user then waited
for a message that was never going to be sent. The endpoint was not broken in any way a monitor
could see — it was working exactly as written, and what it was written to do was nothing.

13-CONTEXT was explicit that this phase must not leave a flow that silently does nothing, and gave
two ways out: implement a minimal consumer, or declare email out of scope and say so.

## The decision

**Email delivery is out of scope for this milestone, and the endpoint says so rather than pretending.**

A real consumer means an SMTP or provider integration, per-tenant sender configuration, bounce
handling and a template story. None of that is in phase 13's scope and all of it would consume the
budget the phase's three actual blockers need.

A *fake* consumer — accept a message, log it, drop it — was considered and rejected. It is strictly
**worse** than the status quo: it makes a dead flow look alive to everyone who reads the code
afterwards, and it converts a gap someone can find into one nobody will. No stub was created, and
none should be.

## What ships instead

`restaurantos.auth.password-reset.delivery-mode`, default **`disabled`**.

| Mode | Behaviour of `POST /api/v1/auth/reset-password/request` |
|---|---|
| `disabled` *(default)* | Issues no token. Writes no outbox row. Reads no row at all — it returns before the tenant is even resolved. Answers `200` with warning `RESET_DELIVERY_DISABLED` naming the supported route. |
| `outbox` | Issues a token subject to the per-account cooldown, retires any outstanding one, and emits `PASSWORD_RESET_REQUESTED`. |

auth-service logs a `WARN` at startup whenever the mode is `disabled`, naming the property. A
silently disabled reset flow is indistinguishable from a broken mail configuration, and without the
warning the first thing that reveals it is a user complaint pointing at the wrong subsystem.

**The disabled response is account-independent, and that is load-bearing.** Turning a flow off is
the easiest way in the world to build an account-existence oracle — refuse for unknown addresses,
accept for known ones. The disabled branch runs before any tenant lookup and before any row is read,
so the response cannot differ by address, by tenant, or in the time it takes to produce.

### Supported password recovery in this milestone

1. **Administrator-initiated reset** (plan 13-13) — a tenant admin resets a tenant user; a
   SuperAdmin resets a tenant admin. Sets a temporary password, sets `must_change_password`, revokes
   sessions, emits an audit event.
2. **Authenticated self-service change** (plan 13-04) — `POST /api/v1/auth/change-password`, for a
   user who can still sign in.
3. **Forced change at login** (plan 13-08) — `POST /api/v1/auth/change-password/forced`, for a user
   holding a temporary password.

Self-service *forgot*-password is **not** supported and the endpoint says so.

## What the event carries now, and what a future consumer must do

```jsonc
// PASSWORD_RESET_REQUESTED on auth.topic, routing key auth.user.password_reset_requested
{ "userId": "…", "email": "…", "tokenId": "…" }
```

Typed as `io.restaurantos.shared.event.payload.PasswordResetRequestedPayload` in `shared-lib`, so a
producer-side rename is a compile error in the consumer rather than a field that quietly reads null.

**`tokenId` is the `password_reset_tokens` row handle. It is NOT the token.** Until plan 13-09 this
payload carried `token` — the *raw* reset credential, in plaintext, in the same durable, replicated,
backed-up row as auth-service's own SHA-256 of it. The hashing was decorative: read access to
`event_outbox`, to a backup of it, to a replica, or to the broker was account takeover for anyone
who had ever requested a reset.

A consumer therefore **must not** expect the token in the event. It must:

1. Read `tokenId` from the payload.
2. Ask auth-service for a delivery-ready reset link over the internal channel
   (`X-Internal-Service` shared secret, `/internal/auth/**`, which the gateway deliberately does not
   route — see `JwtGlobalFilter`), keyed on that handle.
3. **That internal endpoint does not exist yet.** Writing it is part of picking this gap up, and it
   is the piece that needs the most care: it hands out a live credential, so it must be
   single-fetch, short-lived, and refuse a handle whose token is already used or expired.

Do **not** solve this by putting the token back in the event. The event is persisted, relayed and
retained; the token is a credential; those two properties are incompatible and that is the whole
finding.

## Also missing, for whoever picks this up

- Per-tenant sender configuration. The columns exist on the tenant record and are never read
  (13-CONTEXT, "Deferred Ideas").
- Bounce and delivery-failure handling. A reset that fails to send currently has nowhere to be
  reported.
- Templates and localisation.
- The same gap applies to **user invites** (13-11), which have the same dead path.

## Where to look

| Thing | Path |
|---|---|
| The switch | `services/auth-service/src/main/java/io/restaurantos/auth/config/PasswordResetDeliveryProperties.java` |
| The flow | `services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordResetService.java` |
| The event contract | `shared-lib/src/main/java/io/restaurantos/shared/event/payload/PasswordResetRequestedPayload.java` |
| The empty module | `services/notification-service/` |
| Both modes, asserted | `services/auth-service/src/test/java/io/restaurantos/auth/integration/PasswordResetHardeningIT.java`, `…/PasswordResetDeliveryDisabledIT.java` |
| Both modes, live | `scripts/e2e/phase13-reset-hardening-e2e.sh` |
