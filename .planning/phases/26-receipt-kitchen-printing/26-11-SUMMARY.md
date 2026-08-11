---
phase: 26
plan: "11"
subsystem: print-agent
status: partial
tags: [print-agent, credential, claim, lease, gateway, deployability, cloud]
requires:
  - 26-03 (print_jobs)
  - 26-06 (the agent's queue and transports)
  - 26-07 (the rows the agent claims)
provides:
  - "`print_agents` — a per-branch machine credential, bcrypt, forced-RLS"
  - "`PrintJobClaimService` — claim / acknowledge / lease reclaim"
  - "`POST /api/v1/pos/print-agent/claim` and `/ack` — device-authenticated, exempt from the user JWT"
  - "`POST|GET|DELETE /api/v1/pos/print-agents` — enrol, list, revoke (branch.manage)"
  - "`JwtGlobalFilter.AGENT_PATHS` + `isAgentPath` — exact-equality exemption"
  - "`print-agent/src/cloud/poll.ts` — the outbound loop"
affects:
  - gateway (one list, one matcher, one branch)
  - pos-service (two migrations, two controllers, one filter)
  - print-agent (cloud channel wired into the existing drain loop)
tech-stack:
  added: []
  patterns:
    [
      the-credential-carries-its-own-tenant,
      lease-not-handover,
      the-servers-reclaim-is-authoritative,
      exact-equality-not-prefix,
      one-delivery-path-for-both-channels,
    ]
key-files:
  created:
    - services/pos-service/src/main/resources/db/migration/V17__print_agents.sql
    - services/pos-service/src/main/resources/db/migration/V18__print_job_lease.sql
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/PrintAgent.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/PrintAgentRepository.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PrintAgentEnrolmentService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PrintJobClaimService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/config/PrintAgentCredentialFilter.java
    - services/pos-service/src/main/java/io/restaurantos/pos/config/PrintAgentSecurityConfig.java
    - services/pos-service/src/main/java/io/restaurantos/pos/config/PrintJobLeaseSweep.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/PrintAgentController.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/PrintAgentAdminController.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PrintAgentEnrolmentIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PrintJobClaimIT.java
    - gateway/src/test/java/io/restaurantos/gateway/filter/JwtGlobalFilterAgentPathTest.java
    - print-agent/src/cloud/poll.ts
    - print-agent/test/cloud-poll.test.ts
  modified:
    - gateway/src/main/java/io/restaurantos/gateway/filter/JwtGlobalFilter.java
    - services/pos-service/src/main/java/io/restaurantos/pos/config/PosSecurityConfig.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/PrintJob.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/PrintJobRepository.java
    - services/pos-service/src/test/java/io/restaurantos/pos/RlsForcedInvariantIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/web/ControllerAuthorizationClosureTest.java
    - print-agent/src/server.ts
    - print-agent/src/main.ts
decisions:
  - "The credential carries its own tenant, because print_agents is FORCE RLS and the agent authenticates before anything knows its tenant"
  - "The tenant and branch used downstream are read from the ROW, never from the string the client sent"
  - "A claim is a LEASE, not a handover; the server's reclaim is authoritative and a late ack is a no-op"
  - "AGENT_PATHS is matched by EXACT EQUALITY, which is why the ack endpoint takes its job id in the body"
  - "The poll loop enqueues onto the existing queue and never delivers directly"
  - "An unknown agent still pays the bcrypt cost, so a fast negative is not an enumeration oracle"
metrics:
  duration: ~3h
  completed: 2026-08-12
commits:
  - 6afd748f feat(26-11) — task 1, the identity
  - 3fe2024d feat(26-11) — task 2, claim/ack/lease and the gateway
  - b193e6ef feat(26-11) — task 3, the poll loop and enrolment endpoints
---

# Phase 26 Plan 11: The Print Agent's Cloud Channel — PARTIAL

**Tasks 1, 2 and 3's agent half are complete and proven against the live stack. Task 3's settings
card and task 4's human checkpoint are NOT done** — see NOT DONE at the end.

This is the plan that makes a cloud-hosted RestaurantOS able to print anything at all. Before it,
every path to a printer went through a browser tab.

## The two endpoints

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v1/pos/print-agent/claim` | `X-Print-Agent-Key`, nothing else |
| POST | `/api/v1/pos/print-agent/ack` | `X-Print-Agent-Key`, nothing else |

And the administrator's half, gated on `branch.manage`:
`POST /api/v1/pos/print-agents`, `GET …?branchId=`, `DELETE …/{agentId}`.

**Defaults:** lease **120 s** (`restaurantos.print.lease-seconds`), sweep every **30 s**
(`restaurantos.print.sweep-interval-ms`), agent poll every **3 s**
(`PRINT_AGENT_POLL_MS`), batch **5**, server clamp **20**, attempt limit **5** — the same
`MAX_ATTEMPTS` the agent's own queue uses, so the two halves cannot disagree.

## The `JwtGlobalFilter.java` diff, reproduced verbatim

```diff
-    private static final List<String> PUBLIC_PATHS = List.of(
+    // Package-private (not private) so JwtGlobalFilterAgentPathTest can assert its SIZE is
+    // unchanged. 26-11 added a sibling list beside it; the guard against that having quietly
+    // grown this one is an assertion on a literal count, not a reviewer's memory.
+    static final List<String> PUBLIC_PATHS = List.of(

+    /**  … full javadoc: why not PUBLIC_PATHS, why the ack id is in the body … */
+    static final List<String> AGENT_PATHS = List.of(
+            "/api/v1/pos/print-agent/claim",
+            "/api/v1/pos/print-agent/ack"
+    );

-    private static final List<String> WS_UPGRADE_PATHS = List.of(
+    // Package-private for the same reason PUBLIC_PATHS is — see the note there.
+    static final List<String> WS_UPGRADE_PATHS = List.of(

         if (isPublicPath(path)) {
             return chain.filter(exchange);
         }
+
+        // 26-11: a print agent carries no user JWT and no tenant header. Forward without either;
+        // pos-service authenticates the X-Print-Agent-Key credential and derives the tenant and
+        // branch from the agent row it resolves to.
+        if (isAgentPath(path)) {
+            return chain.filter(exchange);
+        }

+    boolean isAgentPath(String path) {
+        if (path == null || path.contains("/../") || path.endsWith("/..")) {
+            return false;
+        }
+        return AGENT_PATHS.contains(path);
+    }
```

**That is the whole diff.** One list, one matcher, one branch, plus two `private` → package-private
widenings the plan explicitly sanctioned so the neighbouring lists' contents can be asserted. No
existing method body is modified. `PUBLIC_PATHS`, `TENANT_OPTIONAL_PATHS` and `WS_UPGRADE_PATHS` are
untouched, `application.yml` and `RouteFeatureMap.java` are byte-identical, and all three facts are
asserted by tests rather than by this paragraph.

`JwtGlobalFilterAgentPathTest` replaces the plan's empty-git-diff gate — which could never have
passed, since it asserted the file could not change while requiring a change to it. Twenty-five
assertions, including the **full literal contents** of `PUBLIC_PATHS` and `WS_UPGRADE_PATHS`, so a
later widening fails on the commit that makes it rather than at a review that does not happen.

## Why the credential carries its own tenant

`print_agents` is FORCE RLS. The agent authenticates before anything knows its tenant, and under
forced RLS a query issued with no `app.current_tenant_id` returns **zero rows rather than erroring**
— so a lookup by credential alone would always find nothing and would be indistinguishable from a
wrong secret. The credential is therefore
`rosprt.<tenant-hex-32>.<lookup-id>.<secret>`, and the filter sets the GUC from it before the lookup.

That is safe because the tenant id is not the secret, and because **the tenant and branch used
downstream are read from the ROW**. A forged tenant segment finds no row, or a row whose bcrypt hash
you cannot match. The lookup id exists because bcrypt hashes are salted: without it, resolving a
credential would mean comparing against every agent of the tenant at ~100 ms each, which is a
denial-of-service vector aimed at ourselves.

## The double-print window, sized rather than denied

If a delivery outlasts its lease, the sweep may hand the job to another agent while the first is
still printing. Mitigated on both sides:

- **The server's reclaim is authoritative.** A late acknowledgement — expired lease, or a job since
  claimed by a different agent — is a **no-op**. It cannot mark PRINTED a job a sibling is mid-way
  through, and it cannot increment an attempt count that no longer belongs to it.
- **The agent treats a rejected ack as information**, not as an error, and does not retry it.
- **The lease is generous** (120 s) against work that takes a printer a second or two.

**The residual window is real:** an agent wedged for longer than the lease which then completes will
print a ticket a second agent already printed. A duplicated kitchen ticket is a wasted plate;
pretending the window does not exist would be worse than sizing it.

## Negative controls — eleven, and three of them taught me something

**Task 1, three, all red:** log the secret on enrolment; ignore `revoked_at`; `ENABLE` RLS without
`FORCE` (caught by the migration's own self-check).

**Task 2, three run, one red first time and two run down:**

| Sabotage | Result |
| --- | --- |
| a late ack overwrites the server's reclaim | **RED** |
| drop the branch check in `acknowledge` | **GREEN — a weak test.** Every foreign job in the existing case is `QUEUED`, so the `stillOurs` guard rejected it for an unrelated reason and the branch check was covered only by accident. Added a test that builds the one state where it is the only guard — a CLAIMED foreign-branch job naming this agent with a live lease. Sabotage re-run: **RED**. |
| trust the client's claimed tenant instead of the row's | **GREEN — a bad sabotage.** At that line the two values are provably equal, because `findForAuthentication` names both. Re-aimed at the real guard — dropping that tenant predicate — it goes **RED** on the unknown-tenant case. |

**Task 3, four, all red:** do not enqueue; keep polling after revocation; report a rejected ack as
applied; allow concurrent polls.

## Real command output

```
$ mvn -pl services/pos-service verify
pos-service ITs: 241 tests, 0 failures, 0 errors        (was 216 before this plan)
$ mvn -pl gateway test
gateway: 104 tests, 0 failures, 0 errors
$ cd print-agent && npx tsc --noEmit && npm test
TYPECHECK clean ·  Tests  99 passed (99)      # still exactly one runtime dependency
$ git diff --quiet HEAD -- gateway/src/main/resources/application.yml && echo UNCHANGED
UNCHANGED
$ git diff --quiet HEAD -- .../support/RouteFeatureMap.java && echo UNCHANGED
UNCHANGED
```

### Live, end to end, against the running stack

pos-service and the gateway were both rebuilt (107 MB / 467 BOOT-INF entries, and 118 MB / 239) and
restarted; `check-stale-jars.sh` reports both `ok`.

```
$ # 1. enrol, as a tenant admin holding branch.manage
POST /api/v1/pos/print-agents  {"branchId":"34cd6f62-…","label":"Kitchen till (26-11 live proof)"}
  agentId : 463762ae-4ff5-4740-a376-8dff53b997ca
  secret  : rosprt.d108c2e6a70d49c8acdc37531fd752d8.DVQhd...     ← shown exactly once

$ # 2. the list endpoint, checked for the secret
GET /api/v1/pos/print-agents?branchId=…
{"data":[{"agentId":"463762ae-…","label":"Kitchen till (26-11 live proof)",
          "createdAt":"2026-08-11T20:06:29.649254Z","revokedAt":null,"lastSeenAt":null}]}
  SECRET PRESENT IN LIST RESPONSE: False

$ # 3. a cashier fires an order
POST /api/v1/pos/orders/{id}/send-to-kds     ->  FIRED: ORD-20260812-0005 SENT_TO_KDS

$ # 4. THE CLAIM — no Authorization header, no user token, no browser process involved
POST /api/v1/pos/print-agent/claim   -H "X-Print-Agent-Key: rosprt.…"
  leaseExpiresAt: 2026-08-11T20:10:59.485972Z
  jobs claimed : 1
     ce99acc9-c4f7-47fc-bfbb-8a7c5dc49a16 | kitchen-main | KITCHEN_TICKET
     ticket: {"firedAt":"2026-08-11T20:08:58.993103Z","serverRef":"eb2ee67e-…",
              "coverCount":4,"revisionNo":1,…}

$ # 5. acknowledge
POST /api/v1/pos/print-agent/ack  {"printJobId":"ce99acc9-…","result":"DELIVERED"}
{"data":{"applied":true,"status":"PRINTED"}}
 target_printer_id | status  | attempts | lease_expires_at
-------------------+---------+----------+------------------
 kitchen-main      | PRINTED |        0 |

$ # 6. nothing queued is a 200 with an empty list, never an error
POST …/claim  ->  {"data":{"jobs":[],"leaseExpiresAt":null}}   HTTP 200

$ # 7. the credential against an order endpoint
GET /api/v1/pos/orders/{id}?branchId=…  -H "X-Print-Agent-Key: …"   ->  HTTP 401

$ # 8. revoke, then the VERY NEXT claim
DELETE /api/v1/pos/print-agents/463762ae-…    ->  revokedAt: 2026-08-11T20:09:24Z
POST …/claim  ->  HTTP 403          # no cache window
GET  …/print-agents  ->  revoked: True | lastSeen: 2026-08-11T20:09:14Z
                          secret anywhere in response: False
```

Step 4 is the plan's purpose, demonstrated: **a kitchen ticket was fetched from the cloud by a
process holding only a device credential, with no browser and no user token anywhere in the
request.** What it does not yet demonstrate is paper — see NOT DONE.

## Deviations from Plan

### 1. [Rule 3 — blocking] The migrations are V17 and V18, not V14

V14, V15 and V16 were taken by later phases (`station_type`, `pos_terminals`,
`menu_station_routes`) while 26-11 was being planned. V18 exists because the lease needs three
columns `print_jobs` does not have, and V13 is already applied to the live database — amending it
would break its checksum.

### 2. [Rule 3 — blocking] Two Spring cycles and a condition that did not bind

- `PosSecurityConfig → PrintAgentCredentialFilter → PrintAgentEnrolmentService → the PasswordEncoder
  bean PosSecurityConfig declared`. Fixed by moving the encoder to `PrintAgentSecurityConfig`, which
  takes no constructor arguments and therefore cannot close a cycle.
- The lease sweep began as a static nested `@Component` inside a `@Configuration`, and its
  `@ConditionalOnProperty` **did not take effect there**. It kept running in a test that had
  switched it off, incremented a job's attempt count a second time between two lines of an
  assertion, and produced a failure that read like a bug in the reclaim. It is now a top-level class
  and **its absence is asserted** by a test rather than assumed.

### 3. [Rule 3 — blocking] A test assertion that was asserting execution order

`anExpiredLeaseReturnsTheJob` asserted the sweep reclaimed **exactly one** job. The sweep is
deliberately tenant-wide — it runs on a timer with no request and therefore no tenant context — so a
sibling test's leftover claim in the shared database expired on the same advanced clock. Loosened to
"at least one" **with the reason in a comment**, and the specific row's transition is still asserted
exactly. This is the one place in this plan where an assertion was weakened, and it was weakened
because it was measuring the rest of the file rather than the code.

### 4. [Scope] `spring-security-test` was NOT added

`PrintJobClaimIT` needs the real security filter chain in MockMvc. The idiomatic route is
spring-security-test's `springSecurity()` configurer, which is not on pos-service's test classpath.
Rather than add a dependency — the plan's acceptance criteria include adding no package — the test
autowires the `FilterChainProxy` bean and calls `.addFilters(...)`. That is all the configurer wires
in anyway.

### 5. [Scope] Both new controllers were added to `ControllerAuthorizationClosureTest`

Including the device-facing one, rather than allowlisting it out as an internal controller. Its gate
is the `PRINT_AGENT` authority, which no user holds and no other endpoint asks for — so it *is*
gated, and the closure test's whole point is that an ungated endpoint is the absence of a line
nobody reviews. The list size moved 7 → 9.

## NOT DONE

1. **The settings-screen enrolment card** (`agent-enrolment-card.tsx` and its test — the last three
   of task 3's nine behaviours). The endpoints it would call are live and were exercised by curl
   above, including the once-only secret and the immediate revocation. What is missing is the UI: a
   manager currently enrols an agent with an HTTP client, not with a button.
2. **Task 4, the human checkpoint.** Its steps 1–3, 5 (in the byte sense), 7 and 8 are covered by
   the live run and the test suite. **Step 5 on real paper, and step 6 (kill the agent mid-job and
   confirm exactly-once), have not been performed.** Step 6 in particular is testable without
   hardware and is the honest gap: the lease reclaim is integration-tested with an injected clock,
   but nobody has killed a real agent process mid-delivery and watched the outcome.
3. **The `print-agent` daemon has not been run against the live cloud.** `poll.ts` is unit-tested
   against a fake server and wired into `main.ts`, and the endpoints it calls were driven by curl —
   but the loop itself has not polled the real gateway. That is the last mile between "the channel
   works" and "the product prints".

## Hardware sign-off (U3)

1. Step 5 of the checkpoint on real paper: that a ticket physically emerges with every browser
   closed. The claim proves the bytes were fetched; only paper proves the whole chain.
2. Whether a kitchen printer idle for hours between services accepts the first job without a
   warm-up failure.

## Known stubs

- `PrintAgent.lastSeenAt` is written on every claim and shown by the list endpoint, but nothing
  alerts on an agent that has stopped polling. That is monitoring, and this plan does not add any.
- The agent's `/health` does not yet surface the cloud channel; `poll.health()` exists and returns
  the state, but `server.ts`'s health payload does not include it. Task 4 step 8 expects it.

## Threat flags

None new. Register status: T-26-11-A (the credential grants one authority no controller but its own
asks for; asserted live at HTTP 401 against an order endpoint), -B (bcrypt 12, revocable with no
cache window, asserted live), -C (shown once; a log-scanning test over enrolment and every refusal
branch), -D (tenant AND branch in every predicate plus forced RLS; both negatives asserted, one of
them strengthened after a sabotage survived), -E (exact equality, near-miss and dot-dot variants
asserted not to classify, both neighbouring lists asserted verbatim), -J (the ack id is in the body
and the reasoning is in a comment on `AGENT_PATHS`), -K (no `RouteFeatureMap` entry — asserted
unchanged), -F (lease reclaim, driven by an injected clock), -G (late ack is a no-op; residual
window documented), -H (revocation stops the loop and logs once), -I (an explicitly empty result,
asserted at the service and over HTTP), -SC (no package added to any manifest — including the
deliberate avoidance of `spring-security-test`).

## Self-Check: PASSED

Every file named in `key-files` exists on disk and every commit hash in `commits` resolves in
`git log`. Verified by script, not by memory.
