"use client";

import Link from "next/link";

import { GuideSection } from "@/components/finance/guide/GuideSection";
import { allGuideTabs } from "@/lib/finance/guide/tabs";

/**
 * The Guide tab (D-37-03, FIN-13) — the thing the user asked for by name:
 * *"a complete guide tab in Financial system which will explain how this module is working, what
 * each tab/module is and how it functions."*
 *
 * <h3>What makes it different from documentation</h3>
 *
 * Every boxed rule on this page comes from `claims.json`, and `make verify-guide-claims` refuses to
 * pass unless each of those sentences names a live, non-skipped test and every code it mentions
 * still exists in the service source. This page therefore cannot quietly go out of date while the
 * product moves on — the build finds out first. A guide that lies is worse than no guide, because
 * it is trusted.
 *
 * <h3>Heading structure</h3>
 *
 * One `h1` on the page (in the route), one `h2` per finance tab, `h3` for the rules inside a
 * section. Nothing skips a level, so the page reads correctly to a screen reader and its outline
 * matches what a sighted reader sees.
 */
export function GuideTab() {
  const tabs = allGuideTabs();

  return (
    <div className="space-y-8">
      <nav aria-label="Sections" className="rounded-lg border p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Jump to
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {tabs.map((tab) => (
            <li key={tab.anchor}>
              <Link href={`#${tab.anchor}`} className="text-primary hover:underline">
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tabs.map((tab) => (
        <GuideSection key={tab.href} tab={tab} />
      ))}
    </div>
  );
}
