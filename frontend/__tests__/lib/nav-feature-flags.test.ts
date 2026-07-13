import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS } from "@/lib/features/feature-flags";
import { navGroups, tenantNavItems, type NavItem } from "@/components/shared/sidebar-nav-items";

// Frontend package root (this file is at <root>/__tests__/lib/); repo root is one up.
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = path.resolve(frontendRoot, "..");

const TIER_FEATURE_DEFAULTS_PATH = path.join(
  repoRoot,
  "services/platform-admin-service/src/main/java/io/restaurantos/platform/config/TierFeatureDefaults.java",
);
const ROUTE_FEATURE_MAP_PATH = path.join(
  repoRoot,
  "gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java",
);

function collectFeatureCodesFromFile(filePath: string): Set<string> {
  const source = fs.readFileSync(filePath, "utf-8");
  const matches = source.match(/FEATURE_[A-Z_]+/g) ?? [];
  return new Set(matches);
}

// Every nav feature string, walked from BOTH the flat list and the nested
// groups (recursing into `items`).
function collectNavFeatures(): { label: string; feature: string; href: string }[] {
  const found: { label: string; feature: string; href: string }[] = [];

  const visit = (item: NavItem) => {
    if (item.feature) {
      found.push({ label: item.label, feature: item.feature, href: item.href });
    }
  };

  tenantNavItems.forEach(visit);
  navGroups.forEach((group) => group.items.forEach(visit));

  return found;
}

describe("nav feature-flag drift guard", () => {
  it("every nav item feature string is a canonical FEATURE_FLAG", () => {
    const navFeatures = collectNavFeatures();

    for (const { label, feature } of navFeatures) {
      expect(
        (FEATURE_FLAGS as readonly string[]).includes(feature),
        `Nav item "${label}" references unknown flag "${feature}" — not in the canonical FEATURE_FLAGS set`,
      ).toBe(true);
    }
  });

  it("the purchasing nav item gates on FEATURE_VENDOR", () => {
    const navFeatures = collectNavFeatures();
    const purchasingItem = navFeatures.find((item) => item.href === "/app/purchasing");

    expect(purchasingItem).toBeDefined();
    expect(purchasingItem?.feature).toBe("FEATURE_VENDOR");
  });

  it("FEATURE_FLAGS matches the backend catalogue (read off disk)", () => {
    const tierDefaultsCodes = collectFeatureCodesFromFile(TIER_FEATURE_DEFAULTS_PATH);
    const routeMapCodes = collectFeatureCodesFromFile(ROUTE_FEATURE_MAP_PATH);
    const backendCodes = new Set([...tierDefaultsCodes, ...routeMapCodes]);

    // Every flag used by a nav item must exist in the backend-extracted set —
    // reading the Java source keeps the two sides genuinely coupled. A
    // constant that merely restates the frontend's own list would guard
    // nothing.
    const navFeatures = collectNavFeatures();
    for (const { label, feature } of navFeatures) {
      expect(
        backendCodes.has(feature),
        `Nav item "${label}" references "${feature}" which does not exist in ` +
          `TierFeatureDefaults.java or RouteFeatureMap.java`,
      ).toBe(true);
    }
  });
});
