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

function hasFeature(
  feature: string | undefined,
  features: string[] | undefined,
  isPending: boolean,
  isError: boolean,
  failOpenOnError: boolean,
): boolean {
  if (!feature) return true;
  if (isPending) return false;
  if (isError || !features) return failOpenOnError;
  return features.includes(feature);
}

// Role gate for nav items that have no permission in the DB catalog yet (HR/CRM/
// Reporting placeholders): without this they are feature-only and therefore visible
// to every role. An item with `roles` is shown only if the user holds one of them.
function hasRole(
  userRoles: string[],
  required: string[] | undefined,
): boolean {
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
