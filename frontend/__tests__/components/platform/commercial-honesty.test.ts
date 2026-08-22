import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FRONTEND_ROOT, stripComments } from "../../lib/theme/module-graph";

/**
 * The control plane may not invent money.
 *
 * <h3>The fact this gate exists to keep true</h3>
 *
 * **This product has no billing.** Every `@Table` across sixteen services was enumerated and a
 * repo-wide search for `stripe|paddle|chargebee|razorpay|mrr|arr|plan_price` returns five hits, all
 * of them the string `billing_ref` — a free-text VARCHAR on the tenant row with no foreign key and
 * no writer beyond an operator typing into it. There is no invoice entity, no payment entity, no
 * processor client and no webhook anywhere.
 *
 * <p>So there is no revenue, no MRR, no ARR, no payment status, no failed-payment list, no dunning
 * and no churn value that this console could compute. `subscription_plans.price_paisa` is what a
 * plan is SOLD at; what was RECEIVED is not recorded anywhere in the product, and the backend states
 * that in one place (`SubscriptionDtos.REVENUE_NOT_AVAILABLE`) precisely so a screen can render the
 * absence rather than quietly filling the slot.
 *
 * <h3>Why a gate and not a code review</h3>
 *
 * The type system already stops the crudest version: `StatTile`'s props are a discriminated union,
 * so a tile cannot carry a `value` and an `unavailableReason` together. What it cannot see is a
 * tile that computes `pricePaisa * subscriptionCount`, formats it, and passes the result as a
 * perfectly legal `value`. That line compiles, reads as diligence, and puts a fabricated commercial
 * figure on the screen where commercial decisions are made — and on a control plane a fabricated
 * figure is not merely wrong, it is acted on. It is also exactly the "helpful" addition a later
 * author makes when a tile marked unavailable looks to them like an unfinished one.
 *
 * <p>The scope is the whole control plane — `app/(platform)/**` and `components/platform/**` — not
 * just the subscription screens, because the analytics, dashboard and tenant surfaces are equally
 * one plausible-looking `reduce` away from the same defect. It is green across every file in both
 * trees today.
 *
 * <h3>Negative controls — run, OBSERVED RED, then reverted (D-38-07)</h3>
 *
 * 1. Added `const annualised = plans.reduce((t, p) => t + p.pricePaisa, 0);` to
 *    `components/platform/plan-catalogue.tsx`. → RED: "a paisa figure is accumulated or multiplied"
 *    named `components/platform/plan-catalogue.tsx:87`. Reverted.
 * 2. Changed that tile's `unavailableReason` to `value={formatNumber(subscribed)}`. → RED: "a tile
 *    labelled with a commercial figure states the absence" named
 *    `components/platform/plan-catalogue.tsx — "Revenue from these plans"`. Reverted.
 * 3. Neutralised the billing sentence in `subscription-register.tsx` and `plan-catalogue.tsx`, so
 *    the absence was omitted rather than stated. → STILL GREEN, and the reason is worth recording:
 *    `tenant-subscription-panel.tsx` states it too, which is what "somewhere on the control plane"
 *    means and is the correct answer — one screen may legitimately drop the tile while another
 *    carries the statement. Neutralising all THREE went RED: "no control-plane screen states that
 *    billing is not integrated". Reverted. The assertion is deliberately fleet-wide rather than
 *    per-file, so a screen can be redesigned without tripping it while the statement itself cannot
 *    quietly leave the product.
 */

const CONTROL_PLANE = ["app/(platform)", "components/platform"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out.sort();
}

const SOURCES = CONTROL_PLANE.flatMap((dir) => sourceFiles(resolve(FRONTEND_ROOT, dir)));

function rel(file: string): string {
  return relative(FRONTEND_ROOT, file);
}

/**
 * A paisa amount on either side of `*`, `+` or `+=`.
 *
 * <p>Rendering one is fine and is what `MoneyDisplay` is for — `paisa={plan.pricePaisa}` matches
 * nothing here. What is banned is DOING ARITHMETIC with it, because there is no arithmetic on a
 * list price that produces a figure this system knows: two plan prices added together is not
 * revenue, a price times a subscriber count is not revenue, and neither becomes true by being
 * labelled carefully.
 */
const PAISA_ARITHMETIC = [
  /\b\w*[Pp]aisa\b\s*(?:\*|\+=|\+(?!\+))/,
  /(?:\*|\+=|\+(?!\+))\s*[\w.]*\b\w*[Pp]aisa\b/,
];

/** A tile label a reader would take as a commercial figure. */
const COMMERCIAL_LABEL = /revenue|\bMRR\b|\bARR\b|churn|invoice|payment|dunning|billed/i;

describe("the control plane may not invent money", () => {
  it("scans both control-plane trees (a scanner that reads nothing passes anything)", () => {
    expect(SOURCES.length, "control-plane sources scanned").toBeGreaterThan(20);
  });

  it("never accumulates or multiplies a paisa figure", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, index) => {
          if (PAISA_ARITHMETIC.some((pattern) => pattern.test(line))) {
            offenders.push(`${rel(file)}:${index + 1} — ${line.trim()}`);
          }
        });
    }
    expect(
      offenders,
      "a paisa figure is accumulated or multiplied on the control plane. There is no invoice, no " +
        "payment and no processor anywhere in this product, so no sum of list prices is a figure " +
        "this system knows — it is a fabrication with a plausible label. Render the amount through " +
        "`MoneyDisplay` and leave it alone, or state the absence with `StatTile`'s " +
        "`unavailableReason`:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("makes a tile labelled with a commercial figure state the absence rather than show one", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/<StatTile\b([\s\S]*?)\/>/g)) {
        const body = match[1] ?? "";
        const label = /label=\{?"([^"]*)"/.exec(body)?.[1];
        if (!label || !COMMERCIAL_LABEL.test(label)) continue;
        if (!/\bunavailableReason\b/.test(body) || /\bvalue=/.test(body)) {
          offenders.push(`${rel(file)} — "${label}"`);
        }
      }
    }
    expect(
      offenders,
      "a StatTile promises a commercial figure and then renders one. Nothing in this product " +
        "records money received, so these tiles must take `unavailableReason` and say why:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("states the absence of billing somewhere, rather than omitting it", () => {
    const stating = SOURCES.filter((file) => {
      const source = stripComments(readFileSync(file, "utf8"));
      return /unavailableReason=/.test(source) && /[Bb]illing is not integrated/.test(source);
    });
    /*
     * An omission is how this decays. A tile that says "no revenue figure can be computed, and here
     * is why" is a stated absence an operator can act on; a screen with no such tile has a gap where
     * a commercial figure belongs, and the next author fills gaps.
     */
    expect(
      stating.map(rel),
      "no control-plane screen states that billing is not integrated. The absence has to be " +
        "rendered, not merely respected — the backend supplies the sentence for exactly this " +
        "purpose (`SubscriptionDtos.REVENUE_NOT_AVAILABLE`).",
    ).not.toEqual([]);
  });
});
