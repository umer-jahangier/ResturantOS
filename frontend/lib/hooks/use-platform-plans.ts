"use client";

import { useQuery } from "@tanstack/react-query";

import { PlatformRepository } from "@/lib/repositories/platform.repository";
import { platformKeys } from "@/lib/hooks/use-platform-tenants";
import type { SubscriptionPlan } from "@/lib/models/platform.model";

/**
 * Layer-3 hooks for the plan catalogue.
 *
 * <h3>What a plan is, and what it is not</h3>
 *
 * A plan is a name, a list price, a billing period, a trial length and a set of CEILINGS. It is
 * not an invoice, it does not represent money received, and nothing in this product turns one into
 * revenue: there is no invoice entity, no payment entity, no processor client and no webhook across
 * sixteen services — `billing_ref` is a free-text VARCHAR on the tenant row with no foreign key and
 * no writer beyond an operator typing into it.
 *
 * So there is no `usePlanRevenue`, no `useMrr` and no `usePlanChurn` here, and there is no endpoint
 * that could answer one. Where a screen wants a commercial total it renders a stated absence
 * instead, which is the honest surface and — on a control plane, where figures get acted on — the
 * safe one.
 *
 * <h3>There are deliberately no plan MUTATIONS in this file</h3>
 *
 * The API has `POST /plans`, `PATCH /plans/{code}`, `/archive` and `/restore`, and none of them is
 * wired up here. Editing a plan's ceilings does NOT restamp the tenants already on it — the backend
 * says so explicitly — so a catalogue editor that looked like it re-tiered a fleet, and did not,
 * would be a control whose effect the operator cannot see. Re-tiering is a plan CHANGE made per
 * tenant through the subscription endpoint, and that is where this console offers it. The catalogue
 * is read-only until a screen exists that can state that distinction properly.
 */

/**
 * Every plan in the catalogue.
 *
 * Archived plans are excluded unless asked for. They stay readable so historical prices survive a
 * re-pricing — a history row records what a tenant was moved onto AT THE TIME, and the plan behind
 * that code has to still resolve — but they cannot be newly assigned, and the assign endpoint
 * refuses one with a named `PLAN_ARCHIVED` 409 rather than quietly accepting it.
 *
 * `retry: false` for the reason every hook on this console uses it: a 403 here means the principal
 * is not a SuperAdmin, and retrying an authorization refusal three times only delays an honest
 * error behind a spinner that implies something is loading.
 */
export function usePlatformPlans(includeInactive = false) {
  return useQuery<SubscriptionPlan[]>({
    queryKey: platformKeys.plans(includeInactive),
    queryFn: () => PlatformRepository.listPlans(includeInactive),
    staleTime: 60_000,
    retry: false,
  });
}
