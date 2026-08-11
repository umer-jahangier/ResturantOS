import { describe, expect, it } from "vitest";

import { FINANCE_TABS } from "@/app/(tenant)/app/finance/layout";
import { allGuideTabs, guideTabForHref } from "@/lib/finance/guide/tabs";
import { allClaims, CLAIM_ID_PATTERN } from "@/lib/finance/guide/claims";

/**
 * THE test that stops the guide falling behind the module (37-13, T-32-13-D).
 *
 * It reads the LIVE tab array out of the finance layout rather than a copy. The next phase that
 * adds a finance tab will fail here, which is exactly the moment to write its explanation —
 * before the tab ships undocumented, not six months later when someone notices.
 */
describe("guide coverage — every finance tab is explained", () => {
  it("has a section for every tab in the finance layout's array", () => {
    const missing = FINANCE_TABS.filter((tab) => !guideTabForHref(tab.href)).map((t) => t.href);
    expect(
      missing,
      "these finance tabs have no section in lib/finance/guide/tabs.json — write one before " +
        "shipping the tab, per D-37-03",
    ).toEqual([]);
  });

  it("has no section for a tab that no longer exists", () => {
    const hrefs = new Set(FINANCE_TABS.map((t) => t.href));
    const orphans = allGuideTabs()
      .filter((t) => !hrefs.has(t.href))
      .map((t) => t.href);
    expect(
      orphans,
      "the guide explains tabs the module no longer has — a reader would go looking for them",
    ).toEqual([]);
  });

  it("labels match the tab bar, so the guide names what the reader can actually see", () => {
    for (const tab of FINANCE_TABS) {
      expect(guideTabForHref(tab.href)?.label).toBe(tab.label);
    }
  });

  it("demonstrates its own failure mode: an unlisted tab is not silently tolerated", () => {
    // The control. Without this, "every tab has a section" would pass just as happily against a
    // lookup that returned something for any input at all.
    expect(guideTabForHref("/app/finance/a-tab-that-does-not-exist")).toBeUndefined();
  });

  it("answers all four of D-37-03's questions for every tab, in substance not just in shape", () => {
    for (const tab of allGuideTabs()) {
      for (const [field, value] of Object.entries({
        whatItIs: tab.whatItIs,
        whenYouUseIt: tab.whenYouUseIt,
        typicalEntry: tab.typicalEntry,
        affectsDownstream: tab.affectsDownstream,
      })) {
        // A placeholder like "TBD" would satisfy a mere truthiness check.
        expect(value.length, `${tab.label}.${field} is too short to be an answer`).toBeGreaterThan(
          40,
        );
      }
    }
  });

  it("gives every section a unique, stable anchor so a screen can deep-link to it", () => {
    const anchors = allGuideTabs().map((t) => t.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const a of anchors) expect(a).toMatch(/^[a-z0-9-]+$/);
  });

  it("references only claim ids that exist in the registry", () => {
    const known = new Set(allClaims().map((c) => c.id));
    const dangling: string[] = [];
    for (const tab of allGuideTabs()) {
      for (const id of tab.claims) {
        expect(id).toMatch(CLAIM_ID_PATTERN);
        if (!known.has(id)) dangling.push(`${tab.label} → ${id}`);
      }
    }
    expect(dangling, "the guide points at claims the registry does not hold").toEqual([]);
  });

  it("surfaces the four support-ticket rules where an owner will MEET them, not in a general section", () => {
    // D-37-03 names these four explicitly. A rule filed under "general information" is a rule
    // nobody reads before hitting it, so each is asserted against the specific tab it belongs to.
    const claimsFor = (anchor: string) =>
      allGuideTabs().find((t) => t.anchor === anchor)?.claims ?? [];

    // Cash needs an open till → met while settling, so: Takings.
    expect(claimsFor("takings")).toContain("FIN-GUIDE-0001");
    // A closed period refuses a back-dated entry → met on Periods AND Journal Entries.
    expect(claimsFor("periods")).toContain("FIN-GUIDE-0002");
    expect(claimsFor("journal-entries")).toContain("FIN-GUIDE-0002");
    // What a discount does to the ledger → met on Takings AND the General Ledger.
    expect(claimsFor("takings")).toContain("FIN-GUIDE-0003");
    expect(claimsFor("gl")).toContain("FIN-GUIDE-0003");
    // The second-factor prompt → met where a step-up is actually required: closing a period.
    expect(claimsFor("periods")).toContain("FIN-GUIDE-0004");
  });
});
