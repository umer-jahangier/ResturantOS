# Deferred Items — 08.1-pos-inventory-depletion-activation

## 08.1-04 (Task 3 lint verification)

`npm --prefix frontend run lint` exits 1 due to **pre-existing** errors/warnings in files this
plan never touches (confirmed via `git log -- <file>` — all predate this phase, e.g.
`station-picker.tsx`/`use-kds-clock.tsx` from 07.3-10). None are related to the inventory
four-layer slice, recipe-builder UI, or coverage dashboard added in 08.1-04; a targeted lint
of the new/modified inventory files (`git diff` scope) reports zero errors and zero warnings.

Out-of-scope pre-existing lint findings, NOT fixed here per the executor's scope-boundary rule:

- `components/finance/AccountCodeSelect.tsx:29` — `react-hooks/set-state-in-effect`
- `components/finance/GeneralLedger.tsx:27` — `react-hooks/set-state-in-effect`
- `components/finance/JournalEntryForm.tsx:13,54` — layer-boundary violation (`@/lib/api-client/errors`) + `react-hooks/set-state-in-effect`
- `components/finance/PeriodCloseModal.tsx:8` — layer-boundary violation (`@/lib/api-client/errors`)
- `components/kds/station-picker.tsx:102` — `react-hooks/purity` (`Date.now()` in `useMemo`)
- `components/providers/session-provider.tsx:54` — `react-hooks/set-state-in-effect`
- `lib/hooks/kds/use-kds-clock.tsx:44` — `react-hooks/purity` (`Date.now()` in a hook body)
- `components/purchasing/PurchaseOrderFormDialog.tsx:98`, `components/purchasing/VendorInvoiceFormDialog.tsx:98`, `components/ui/data-table.tsx:45` — React Compiler "incompatible library" warnings (react-hook-form `watch()` / TanStack Table `useReactTable()`)
- `lib/hooks/finance/use-accounts.ts:3` — unused imports (warning)
- `mocks/handlers.ts:72`, `mocks/purchasing.handlers.ts:6` — unused-directive/unused-var (warnings)

None of these block 08.1-04's success criteria (no boundary violations in the new inventory
code; the inventory-specific vitest suite and typecheck both pass clean).

## Phase-wide post-merge regression (orchestrator, all 5 waves)

Full both-service IT regression run after Wave 5:

- **inventory-service: 58/58 pass, BUILD SUCCESS** — zero regressions. The RecipeService
  constructor + `createVersion` catalog-validation change (08.1-02) and the DepletionService
  control-flow restructure (08.1-03) broke nothing (RecipeAccessControlIT, RecipeVersionResolutionIT,
  DepletionConsumerIT, and all Phase-8 ITs remain green).
- **pos-service: 3 PRE-EXISTING IT failures, NOT caused by this phase** — proven by re-running the
  same 3 classes at the pre-phase commit `d7bbc71` (before any 08.1 code): they fail identically there.
  All 3 are in files/areas Phase 08.1 never touched (order revision / RLS-under-superuser / void
  branch-isolation — disjoint from the menu-item write path):
  - `OrderRevisionIT.secondFire_...:117` — `LazyInitializationException` on `Order.items` (no session);
    a test-session/fetch issue in the order-revision fixture.
  - `OrderRlsIsolationIT.order_created_under_tenantA_not_visible_under_tenantB:98` — DB-level tenant
    RLS visibility assertion; RLS is inert under the Testcontainers superuser (app owns the tables),
    a known pre-existing condition ([03-03-B] / pos RLS owner-bypass).
  - `VoidOwnOrderIT.cashier_ownOrder_butDifferentBranchThanJwt_isDenied_isolationIntact:162` —
    `PermissionDenied` thrown inside the test's own `createOpenOrderInBranch:111` setup helper.

  These are pre-existing dev-branch test defects to be triaged separately; Phase 08.1's own new
  pos-service IT (`MenuItemEventPublishingIT` 5/5) and capstone (`LiveOrderClosedPayloadIT` 1/1) pass.

## 08.1-06 (Task 3 fleet blast-radius verification)

**Dev-stack RabbitMQ collision (environmental, not a code regression):** the local dev stack's
`restaurantos-rabbitmq` container was running on host `localhost:5672` for the duration of this
plan's Task 3 verification. `inventory-service`/`kitchen-service`/`pos-service`'s test harnesses
(`InventoryTestBase`, `KitchenTestBase`, `PosTestBase`) mock `RabbitTemplate` but do NOT run their
own Testcontainers RabbitMQ broker, so `@RabbitListener` beans fall back to `application.yml`'s
`localhost:5672` default at context startup — colliding with the live dev-stack broker's real
credentials (`AuthenticationFailureException: ACCESS_REFUSED`), which is FATAL (crashes the whole
`ApplicationContext`), unlike the documented non-fatal "connection refused" case (dev stack down).
Ran these three services' verify with `RABBITMQ_HOST=127.0.0.1`/`RABBITMQ_PORT=59999` (an unused
port) to force the tolerated connection-refused path instead of colliding with the live broker,
without touching the running dev-stack container. Confirmed identical to the documented baseline:
inventory-service 58/58, kitchen-service 29/29, pos-service `KitchenItemStatusSyncIT` 4/4 — all
green. Not a code change; not a regression from this plan's shared-lib fix.

**audit-service `AuditConsumerIT`/`AuditImmutabilityIT` — pre-existing, unrelated failure, NOT
fixed here (out of scope):** both fail at Liquibase migration time with
`ERROR: role "audit_writer" does not exist [Failed SQL: (0) GRANT INSERT ON audit_events TO
audit_writer]`. `AuditConsumerIT`/`AuditImmutabilityIT` run their OWN dedicated
`@Container PostgreSQLContainer` + `@Container RabbitMQContainer` (unlike the RabbitMQ collision
above) with no init script that creates the `audit_writer` role before the `010-create-audit-events.xml`
changeset's `GRANT INSERT ... TO audit_writer` runs — a gap in audit-service's own test harness,
disjoint from every file this plan (08.1-06) modified (`TenantAwareMessageProcessor.java`,
`ConsumerRlsGucPropagationIT.java`, `shared-lib`'s `BaseIntegrationTest.java`). Plan 08.1-06's own
acceptance criteria only requires audit-service **test-compile parity**, which is green
(`mvn -f services/audit-service/pom.xml -DskipTests test-compile` — EXIT=0).
