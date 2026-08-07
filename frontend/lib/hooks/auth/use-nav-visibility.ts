"use client";

import { useCallback } from "react";

import type { NavGroup, NavItem } from "@/components/shared/sidebar-nav-items";
import { useCurrentUser } from "./use-current-user";
import { useFeatureFlags } from "./use-feature-flags";

function hasPermission(
  permissions: string[],
  required: string | string[] | undefined,
  mode: "all" | "any" = "all",
): boolean {
  if (!required) return true;
  const list = Array.isArray(required) ? required : [required];
  return mode === "any"
    ? list.some((code) => permissions.includes(code))
    : list.every((code) => permissions.includes(code));
}

/**
 * Whether a nav item's feature gate lets it be DRAWN.
 *
 * <h3>GA-002 — the line that deleted most of the product</h3>
 *
 * This function used to open with `if (isPending) return false;`. One `503` on
 * `/api/v1/feature-flags` therefore removed **8 of 11 navigation items**, with no banner, no
 * toast and no explanation: a MANAGER's sidebar collapsed to Dashboard / Reports / Realtime while
 * POS, Kitchen, Till Review, Inventory, Menu, Purchasing and Customers vanished. Re-logging in
 * once the endpoint answered `200` restored all eight. To the user this is not an outage — it is
 * a product that shrank overnight, which is precisely the "the app is empty" verdict this phase
 * exists to answer.
 *
 * The bug is that PENDING was treated as DENIED. It is not: pending means *the answer is not
 * available yet*, which is the same epistemic state as `isError`, and the code already handled
 * `isError` correctly by failing open. A 503 with TanStack's retry policy keeps the query
 * **pending** through its whole backoff, so in practice the broken branch was the one that ran
 * and the correct branch was never reached.
 *
 * <h3>Why navigation fails OPEN while entitlement fails CLOSED (D-14b-1)</h3>
 *
 * Plan 13-03 decided that ENTITLEMENT checks fail closed, and that decision is untouched here.
 * These are different questions:
 *
 * <ul>
 *   <li><b>Entitlement</b> asks "may this request proceed?", is answered at the gateway and in
 *       each service, and a wrong YES is unauthorised access. Fail closed.</li>
 *   <li><b>Navigation</b> asks "should this link be drawn?", is answered in the DOM, and a wrong
 *       YES is a link that 403s. Fail open.</li>
 * </ul>
 *
 * Failing open here grants nothing. The sidebar is not an authorization boundary and never was —
 * `JwtGlobalFilter` and each service's `@PreAuthorize` are, and neither consults the DOM. The
 * worst case of a wrong YES is one refused round trip; the worst case of a wrong NO is a
 * restaurant that cannot find its own point of sale.
 *
 * Permission and role gates are deliberately NOT changed: they read the signed JWT, which is
 * present synchronously and cannot 503, so they have no "not known yet" state to mishandle.
 */
function hasFeature(
  feature: string | undefined,
  features: string[] | undefined,
  isPending: boolean,
  isError: boolean,
  failOpenOnError: boolean,
): boolean {
  if (!feature) return true;
  // "Not yet known" and "could not be known" are the same fact to a menu. Both defer to the
  // caller's posture, which defaults to open.
  if (isPending || isError || !features) return failOpenOnError;
  return features.includes(feature);
}

// Role gate for nav items that have no permission in the DB catalog yet (HR/CRM/
// Reporting placeholders): without this they are feature-only and therefore visible
// to every role. An item with `roles` is shown only if the user holds one of them.
function hasRole(userRoles: string[], required: string[] | undefined): boolean {
  if (!required || required.length === 0) return true;
  return required.some((role) => userRoles.includes(role));
}

/** Mirrors sidebar guard logic so empty nav groups can be hidden. */
export function useNavItemVisible(
  item: NavItem,
  options?: { failOpenOnFeatureError?: boolean },
): boolean {
  const failOpen = options?.failOpenOnFeatureError ?? true;
  const { permissions, roles } = useCurrentUser();
  const { data: features, isPending, isError } = useFeatureFlags();

  if (item.comingSoon) {
    return false;
  }
  if (!hasRole(roles, item.roles)) {
    return false;
  }
  if (!hasPermission(permissions, item.permission)) {
    return false;
  }
  return hasFeature(item.feature, features, isPending, isError, failOpen);
}

export function useNavGroupVisibility(
  group: NavGroup,
  options?: { failOpenOnFeatureError?: boolean },
): { hasVisibleItems: boolean; isItemVisible: (item: NavItem) => boolean } {
  const failOpen = options?.failOpenOnFeatureError ?? true;
  const { permissions, roles } = useCurrentUser();
  const { data: features, isPending, isError } = useFeatureFlags();

  const isItemVisible = useCallback(
    (item: NavItem) => {
      if (item.comingSoon) {
        return false;
      }
      if (!hasRole(roles, item.roles)) {
        return false;
      }
      if (!hasPermission(permissions, item.permission)) {
        return false;
      }
      return hasFeature(item.feature, features, isPending, isError, failOpen);
    },
    [roles, permissions, features, isPending, isError, failOpen],
  );

  const hasVisibleItems = group.items.some(isItemVisible);
  return { hasVisibleItems, isItemVisible };
}
