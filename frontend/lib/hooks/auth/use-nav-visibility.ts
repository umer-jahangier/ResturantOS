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

/** Mirrors sidebar guard logic so empty nav groups can be hidden. */
export function useNavItemVisible(
  item: NavItem,
  options?: { failOpenOnFeatureError?: boolean },
): boolean {
  const failOpen = options?.failOpenOnFeatureError ?? true;
  const { permissions } = useCurrentUser();
  const { data: features, isPending, isError } = useFeatureFlags();

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
  const { permissions } = useCurrentUser();
  const { data: features, isPending, isError } = useFeatureFlags();

  const isItemVisible = useCallback(
    (item: NavItem) => {
      if (!hasPermission(permissions, item.permission)) {
        return false;
      }
      return hasFeature(item.feature, features, isPending, isError, failOpen);
    },
    [permissions, features, isPending, isError, failOpen],
  );

  const hasVisibleItems = group.items.some(isItemVisible);
  return { hasVisibleItems, isItemVisible };
}
