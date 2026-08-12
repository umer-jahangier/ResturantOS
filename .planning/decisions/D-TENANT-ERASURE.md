# Tenant erasure: what "purge" claimed, what it does, and what real erasure would cost

**Decision date:** 2026-08-13
**Decision:** the operation is renamed to say what it does. **Real erasure is NOT built**, and two of
the questions it depends on are the product owner's to answer, not an engineer's.

---

## What was there

`TenantLifecycleService.purge()`, exposed as **`DELETE /api/v1/platform/tenants/{tenantId}`**
returning **`204 No Content`** — the two loudest signals HTTP has for *"this is gone"*. The class
javadoc stated the transition as `CANCELLED → PURGED (hard-delete on explicit request only)`.

The whole implementation:

```java
tenant.setStatus(TenantStatus.PURGED);
tenantRepository.save(tenant);
updateStatusKey(tenantId, TenantStatus.PURGED);
```

It deletes nothing. Not the tenant row in `platform_db`, not the HQ branch in `user_db`, not the
admin user in `auth_db`, not the chart of accounts in `finance_db`, and nothing in the eleven other
databases.

**The claim had already spread into two other components.** `PlatformDtos` and
`ImpersonationQueryService` both explained their null-handling by saying a PURGED tenant's
registration row is deleted so the lookup misses — reasoning built on a premise nobody had tested.
Both are corrected. That propagation is the strongest argument for fixing the words rather than
leaving them: a false statement in a codebase does not sit still.

## What it is now

`closePermanently()`, exposed as **`POST /api/v1/platform/tenants/{tenantId}/close`**, returning the
tenant so the response shows the resource still existing in its new status — the same shape as
`/cancel` beside it.

Safe to change the contract: no frontend or e2e caller used the `DELETE`, and **no tenant has ever
reached PURGED** (`platform_db` holds 3 tenants, all ACTIVE).

The close is still strong. A PURGED tenant is refused every tier change by
`TenantSubscriptionService`, its Redis status key makes the gateway reject its requests, and the
console hides it by default. What it is not, is erasure — and **a customer asking "is my data gone"
must not be told yes on the strength of this call.**

## Why erasure was not built instead

**1. A half-built erasure is worse than none.** Fifteen databases, no foreign keys between them. A
saga that misses one leaves the platform reporting an erasure it did not perform. "We don't support
that yet" is a defensible answer; "we told you it was deleted and it wasn't" is not.

**2. The hard part is not technical.** `audit_events` and `impersonation_log` are **deliberately
immutable** — append-only, enforced by triggers added specifically so nobody can rewrite history
(see `040-platform-db-rls-posture.xml`). An erasure that deletes them destroys the accountability
record; one that keeps them leaves personal data behind. Financial records generally carry statutory
retention that outlives an erasure request. **Which of these erasure may touch is a legal question**,
and answering it inside a lifecycle service would be settling it by accident.

**3. It contradicts a posture the codebase already took deliberately.** V15, V12 and V7 all choose
"deactivate, never delete" because `orders.branch_id` must keep naming a real row. Tenant-level hard
deletion breaks that invariant everywhere at once.

**4. Nothing needs it today.** No caller, no PURGED tenant, no customer request.

## What a real erasure would require

Written down so the next person starts from here rather than rediscovering it.

**Two product decisions first — neither is an engineer's to make:**

| Question | Why it blocks |
|---|---|
| Does erasure delete the **audit trail** (`audit_events`, `impersonation_log`)? | They are immutable *by design*. Erasing them removes the record of who did what to that tenant's data — including the record of the erasure. Keeping them retains personal data. |
| Does erasure delete **financial records** (journal entries, invoices, payments)? | Retention obligations commonly outlive an erasure request, and deleting a posted journal entry breaks the ledger's own integrity guarantees. |

**Then the shape of the thing:**

- **A saga, not a transaction.** Fifteen databases with no shared transaction. The template already
  exists — `ProvisioningService` is the mirror image, with per-step compensation and a
  `ManualRepairRecord` for a compensation that itself fails. Erasure needs the same and is harder,
  because a failed erasure cannot be "compensated" by putting the data back.
- **Order matters and is the reverse of provisioning.** Provisioning creates branch → auth tenant →
  admin user → chart of accounts; erasure must unwind from the leaves in, or foreign keys inside
  each database refuse.
- **Idempotent and resumable.** A partial erasure must be safely re-runnable, because the failure
  mode is "half the tenant is gone" and the only way out is forward.
- **It must report what it could not erase**, per database, in the response — not log it. A caller
  reporting to a customer needs the exceptions, not a 204.
- **Backups are outside its reach.** Whatever is decided, restoring from backup reinstates erased
  data. Any promise made to a customer has to account for the retention window.
- **`resolveTenants` in `ImpersonationQueryService` becomes load-bearing** for the reason its comment
  originally (wrongly) gave: with real erasure, a tenant row genuinely can be absent while its
  impersonation records remain.

## Discovery

Found while building e2e branch teardown (`d39b4231`). A disposable-tenant strategy for e2e cleanup
was rejected **specifically because purge does not work** — the throwaway tenants would have
accumulated exactly like the branches the work existed to stop accumulating.
