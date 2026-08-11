/**
 * Typed loader over the finance guide's per-tab prose (D-37-03, plan 37-13).
 *
 * JSON for the same reason `claims.json` is JSON: two consumers read it — the React guide page and
 * `guide-coverage.test.tsx`, which compares it against the finance layout's exported tab array. A
 * tab that ships without a section fails that test, which is the moment to write its section.
 */
import data from "./tabs.json";
import type { FinanceGuideClaimId } from "./claims";

export interface FinanceGuideTab {
  /** Must match an entry in the finance layout's `FINANCE_TABS`. The coverage test enforces it. */
  href: string;
  /** Stable `#fragment`, so a screen can deep-link to its own explanation. */
  anchor: string;
  label: string;
  oneLiner: string;
  /** D-37-03's four questions, in its order. */
  whatItIs: string;
  whenYouUseIt: string;
  typicalEntry: string;
  affectsDownstream: string;
  /** Claim ids from `claims.json`. The renderer looks each up; it cannot print free prose. */
  claims: FinanceGuideClaimId[];
}

const tabs = data.tabs as FinanceGuideTab[];

/** Every guide section, in the order the module presents its tabs. */
export function allGuideTabs(): FinanceGuideTab[] {
  return tabs;
}

export function guideTabForHref(href: string): FinanceGuideTab | undefined {
  return tabs.find((t) => t.href === href);
}
