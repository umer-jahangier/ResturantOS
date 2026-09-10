"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PlatformRepository } from "@/lib/repositories/platform.repository";
import { platformKeys } from "@/lib/hooks/use-platform-tenants";
import type {
  AssignPlanBody,
  CancelSubscriptionBody,
  RenewSubscriptionBody,
  SubscriptionHistoryPage,
  SubscriptionLimitReport,
  SubscriptionRegister,
  TenantSubscription,
} from "@/lib/models/platform.model";

/**
 * Layer-3 hooks for one tenant's commercial arrangement.
 *
 * <h3>What is real here, and what is not</h3>
 *
 * Plans, subscription lifecycle, trials and plan LIMITS are real records with real endpoints, and
 * these hooks read them. **Revenue is not.** This product contains no invoice, no payment, no
 * processor integration and no ledger of platform-side money — `billing_ref` is a free-text VARCHAR
 * with no foreign key and is the only string in sixteen services that resembles billing at all. So
 * there is no MRR hook here, no ARR hook, and no churn-value hook, because there is no endpoint
 * that could answer one and a screen full of fabricated revenue is worse than four honest tiles.
 *
 * A plan's `pricePaisa` is what the plan is SOLD at. It is rendered as such, through
 * `MoneyDisplay`, and never summed into anything that would read as money received.
 */
export function useTenantSubscription(tenantId: string) {
  return useQuery<TenantSubscription>({
    queryKey: platformKeys.subscription(tenantId),
    queryFn: () => PlatformRepository.getSubscription(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Plan ceilings measured against actual usage.
 *
 * Three of the six dimensions cannot be measured from the platform plane today and the response
 * says which, per row, with the reason. The consuming meter must render those as a stated absence
 * — never as a full bar, never as a tick, and never as a zero — because a downgrade applied over a
 * limit nobody checked is exactly the outcome the four-state report exists to prevent.
 *
 * <h3>`enabled` is not an optimisation</h3>
 *
 * The endpoint evaluates a PLAN's ceilings, so it requires a live subscription and refuses when
 * there is none — and today no tenant in this database has one. Firing it unconditionally would
 * paint a red failure notice on every tenant screen for a state that is not a failure at all: a
 * tenant without a subscription draws its entitlements from its tier, and the panel says so. The
 * caller passes the answer to "is there a subscription to measure against?" once it knows.
 */
export function useSubscriptionLimits(tenantId: string, enabled: boolean) {
  return useQuery<SubscriptionLimitReport>({
    queryKey: platformKeys.subscriptionLimits(tenantId),
    queryFn: () => PlatformRepository.getSubscriptionLimits(tenantId),
    enabled: Boolean(tenantId) && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * The append-only trail of everything that moved this tenant's plan, tier or trial.
 *
 * Before this table existed, `tenants.tier` was a column an operator overwrote with no record of
 * the previous value anywhere in the product — no event, no timestamp, and platform_db cannot reach
 * audit_db. The history is the answer to "who moved this tenant, when, and why", and the reason
 * field is populated because every write endpoint demands one.
 */
export function useSubscriptionHistory(tenantId: string, page: number) {
  return useQuery<SubscriptionHistoryPage>({
    queryKey: platformKeys.subscriptionHistory(tenantId, page),
    queryFn: () => PlatformRepository.listSubscriptionHistory(tenantId, page),
    enabled: Boolean(tenantId),
    retry: false,
  });
}

/**
 * The cross-tenant register: every subscription, filtered where the API can filter.
 *
 * <h3>Every filter here is applied server-side, and that is why they are all in the key</h3>
 *
 * `status`, `planCode`, `trialEndingBefore`, `renewingBefore` and the page index each change which
 * rows the API returns. They are not a client-side narrowing of one cached list, so the query key
 * carries all of them — keyed on the page alone, one filter's rows would be served under another
 * filter's heading, which on a register means the console showing the wrong restaurants.
 *
 * <h3>The response is not just rows</h3>
 *
 * It carries `tenantsWithoutSubscription`, which is the coverage figure and belongs on the screen:
 * without it the list reads as "the fleet" while silently omitting every tenant that has no
 * subscription. Nothing was backfilled when the registry shipped, so that number started as the
 * whole fleet. It also carries `revenueNote` — the backend's plain-language statement that billing
 * is not integrated — which the screen renders verbatim instead of inventing an MRR tile.
 */
export function useSubscriptionRegister(params: {
  status?: string;
  planCode?: string;
  trialEndingBefore?: string;
  renewingBefore?: string;
  page?: number;
  size?: number;
}) {
  return useQuery<SubscriptionRegister>({
    queryKey: platformKeys.subscriptions({
      status: params.status,
      planCode: params.planCode,
      trialEndingBefore: params.trialEndingBefore,
      renewingBefore: params.renewingBefore,
      page: params.page ?? 0,
      size: params.size ?? REGISTER_PAGE_SIZE,
    }),
    queryFn: () => PlatformRepository.listSubscriptions({ size: REGISTER_PAGE_SIZE, ...params }),
    staleTime: 15_000,
    retry: false,
  });
}

/**
 * One server page of the register.
 *
 * Fifty, and it is the grid's page size too. `DataGrid` paginates whatever array it is handed, so a
 * server page larger than the grid's own would put a second, differently-numbered pager under the
 * first — two controls disagreeing about what page you are on, on the screen whose whole job is to
 * be countable. One number, used in both places, makes that unrepresentable.
 */
export const REGISTER_PAGE_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lifecycle mutations.
//
// Every one of these takes a MANDATORY `reason` the API refuses to accept blank, and every one of
// them lands in an append-only history row that names the operator who made it — the acting id is
// taken from the verified control-plane token and is never read from the body, so a repudiation
// control's subject cannot choose what it says.
//
// They all invalidate the same fan of keys through `invalidateSubscription`, because one write
// moves several reads at once: a plan change re-stamps the tenant's entitlement ceilings (so the
// tenant row and its usage are stale), writes a history row, and can change what the register says
// about this tenant. Invalidating only the thing that was written is how a console shows an
// operator their own action as not-yet-happened for thirty seconds.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Assign a plan, or move to a different one — now, or on a future date.
 *
 * <h3>The 409 is the useful behaviour and is surfaced, not swallowed</h3>
 *
 * An immediate change to a plan whose ceilings fall below what the tenant MEASURABLY uses is
 * refused with `SUBSCRIPTION_LIMIT_EXCEEDED`, naming each violated limit. `force` applies it anyway
 * and is recorded on the history row as forced. The refusal is the default because a downgrade
 * applied over a limit nobody looked at is the outcome the whole four-state limit report exists to
 * prevent.
 *
 * <p>A SCHEDULED change is deliberately not limit-checked at schedule time: the check would be
 * against today's usage for a change landing in six weeks, and passing it would be a reassurance
 * with no shelf life. The scheduler re-checks when it falls due.
 */
export function useAssignPlan(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<TenantSubscription, Error, AssignPlanBody>({
    mutationFn: (body) => PlatformRepository.assignPlan(tenantId, body),
    onSuccess: () => invalidateSubscription(queryClient, tenantId),
  });
}

/**
 * Cancel the SUBSCRIPTION.
 *
 * **This does not cancel the tenant.** No status change, no feature revocation, no ceiling change —
 * the restaurant keeps serving. `useCancelTenant` is the separate operation that takes one out of
 * service, and conflating the two would let a commercial decision silently stop a POS.
 */
export function useCancelSubscription(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<TenantSubscription, Error, CancelSubscriptionBody>({
    mutationFn: (body) => PlatformRepository.cancelSubscription(tenantId, body),
    onSuccess: () => invalidateSubscription(queryClient, tenantId),
  });
}

/**
 * Withdraw a scheduled plan change and/or a scheduled cancellation.
 *
 * Refused with `NOTHING_SCHEDULED` when there is nothing booked, rather than answering 200 for a
 * no-op. The calling screen only offers the control when something is actually pending, so the
 * refusal should be unreachable — but it is left to surface rather than swallowed, because the one
 * time it fires is the time the screen's idea of the state and the server's have diverged.
 */
export function useCancelScheduledChange(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<TenantSubscription, Error, void>({
    mutationFn: () => PlatformRepository.cancelScheduledChange(tenantId),
    onSuccess: () => invalidateSubscription(queryClient, tenantId),
  });
}

/**
 * Record a renewal an operator KNOWS happened.
 *
 * This is an assertion, not an observation. Nothing in this product sees a payment, which is
 * exactly why the scheduler never rolls a period forward on its own — advancing that date would
 * claim a tenant paid. So the new period end is stated by a person, attributed to them in the
 * trail, and the screen that offers this must say so in those words.
 */
export function useRenewSubscription(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<TenantSubscription, Error, RenewSubscriptionBody>({
    mutationFn: (body) => PlatformRepository.renewSubscription(tenantId, body),
    onSuccess: () => invalidateSubscription(queryClient, tenantId),
  });
}

/**
 * Everything one subscription write can move.
 *
 * The tenant row and its usage are in here because assigning a plan APPLIES that plan's ceilings to
 * the tenant — `maxBranches`, `maxUsers`, `storageGb` and `nlqQuota` are re-stamped from the plan,
 * and the tier moves with it. A console that refetched only the subscription would leave the
 * tenant's own screen showing the ceilings it had a moment ago, which is the staleness that makes
 * an operator apply the same change twice.
 */
function invalidateSubscription(
  queryClient: ReturnType<typeof useQueryClient>,
  tenantId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: platformKeys.subscription(tenantId) });
  void queryClient.invalidateQueries({ queryKey: platformKeys.subscriptionLimits(tenantId) });
  void queryClient.invalidateQueries({
    queryKey: ["platform", "tenants", tenantId, "subscription", "history"],
  });
  void queryClient.invalidateQueries({ queryKey: platformKeys.tenant(tenantId) });
  void queryClient.invalidateQueries({ queryKey: platformKeys.tenants() });
  void queryClient.invalidateQueries({ queryKey: platformKeys.usage(tenantId) });
  // The register is server-filtered and server-paged, so there is no one key to touch — every
  // filter combination is its own cache entry and this tenant's row may appear in any of them.
  void queryClient.invalidateQueries({ queryKey: ["platform", "subscriptions"] });
  // A plan's `subscriptionCount` moved, which is the figure the catalogue uses to make archiving a
  // considered act rather than a guess.
  void queryClient.invalidateQueries({ queryKey: ["platform", "plans"] });
}
