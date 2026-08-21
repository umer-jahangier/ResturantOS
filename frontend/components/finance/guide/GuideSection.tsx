"use client";

import Link from "next/link";

import { ClaimCallout } from "@/components/finance/guide/ClaimCallout";
import type { FinanceGuideTab } from "@/lib/finance/guide/tabs";

/**
 * One finance tab, explained (D-37-03).
 *
 * Four questions, always in the same order, so the page can be skimmed by someone looking for one
 * of them: what it is, when you use it, what a typical entry looks like, and what it affects
 * downstream. The last is the one that makes the module read as a system rather than as eleven
 * unrelated screens, so it names the other tabs out loud.
 *
 * The `id` is a stable anchor — a screen can deep-link to its own explanation, and a support reply
 * can link to a rule rather than paraphrase it.
 */
export function GuideSection({ tab }: { tab: FinanceGuideTab }) {
  return (
    <section
      id={tab.anchor}
      data-testid={`guide-section-${tab.anchor}`}
      data-href={tab.href}
      className="scroll-mt-24 space-y-4 border-b pb-8 last:border-0"
    >
      <div>
        <h2 className="text-h1 font-semibold">
          <Link href={tab.href} className="hover:underline">
            {tab.label}
          </Link>
        </h2>
        <p className="text-small text-muted-foreground">{tab.oneLiner}</p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <Answer term="What it is" definition={tab.whatItIs} />
        <Answer term="When you use it" definition={tab.whenYouUseIt} />
        <Answer term="What a typical entry looks like" definition={tab.typicalEntry} />
        <Answer term="What it affects elsewhere" definition={tab.affectsDownstream} />
      </dl>

      {tab.claims.length > 0 && (
        <div className="space-y-2" data-testid={`guide-claims-${tab.anchor}`}>
          <h3 className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
            Rules worth knowing before you hit them
          </h3>
          {tab.claims.map((id) => (
            <ClaimCallout key={id} id={id} />
          ))}
        </div>
      )}
    </section>
  );
}

function Answer({ term, definition }: { term: string; definition: string }) {
  return (
    <div>
      <dt className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
        {term}
      </dt>
      <dd className="mt-1 text-small leading-relaxed">{definition}</dd>
    </div>
  );
}
