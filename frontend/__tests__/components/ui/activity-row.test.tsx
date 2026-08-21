import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ActivityFeed, ActivityRow, ActivitySubject } from "@/components/ui/activity-row";
import { ZoneProvider } from "@/components/providers/zone-provider";
import {
  BARE_ROUNDED,
  countMatches,
  frontendRoot,
  HAND_ROLLED_TABLE,
  RAW_PALETTE,
  stripComments,
  TYPE_SCALE,
} from "@/__tests__/lib/theme/conformance-scan";

/**
 * `ActivityRow` / `ActivityFeed` / `ActivitySubject` — the demo's `.alert-item` as a primitive
 * (N5; DEMO-COMPONENTS §9, `NEXUS_ERP_Demo.html:347-355`).
 *
 * <h3>What is actually being defended here</h3>
 *
 * Four things, and each one is a defect this repo has already paid for once:
 *
 * 1. **No clock is read at render.** The relative label is a prop. A component that computes
 *    "2m ago" itself hydrates differently than it rendered, and — see `Oldest 113h 52m` on the
 *    live KDS — grows unbounded. The formatter is `lib/format/elapsed.ts`, not this file.
 * 2. **Tone maps to semantic tokens only.** G3 counts `bg-teal-*` as a raw-palette offender, and
 *    the teal ramp's utility namespace is `secondary-*` (D-38-12).
 * 3. **Colour is not the only channel** (D-38-13): the icon is required, and state tones announce
 *    a word.
 * 4. **`operational` is safe by default** (D-38-04): no motion reaches a POS or KDS feed.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * 1. `TONE_CHIP.secondary` → `bg-teal-500/10 text-teal-600`.
 *    → RED twice here: "names the teal by its ramp" and "scores zero on all four gates —
 *    expected 2 to be +0". AND the repo-wide gate went RED in the same state:
 *    `conformance.test.ts` → "no file outside the baseline carries a violation …
 *    components/ui/activity-row.tsx: 2" (14 passed / 1 failed). Restored.
 * 2. The sentence span `text-small` → `text-sm`.
 *    → RED twice: "scores zero on all four gates — expected 1 to be +0" and "uses the contract
 *    type roles for both text tiers". Restored.
 * 3. Dropped the `zone !== "operational"` guard so the transition applied in every zone.
 *    → RED: "expected 'flex w-full items-center gap-2.5 py-2…' not to contain 'transition'".
 *    Restored.
 * 4. Added a `Date.now()` read to the component body.
 *    → RED: "reads no clock … not to match /Date\.now|new Date\(|toLocale/". Restored.
 * 5. Made `icon` optional and rendered `null` in the chip.
 *    → RED: "Unable to find an element by: [data-testid='chip-glyph']". Restored. Note the prop
 *    stays REQUIRED in the type, so deleting the shape channel is a compile error rather than a
 *    review comment; the runtime assertion is the backstop for a caller passing `undefined`.
 */

const SOURCE = stripComments(
  readFileSync(resolve(frontendRoot(), "components/ui/activity-row.tsx"), "utf8"),
);

function renderFeed(props: Partial<React.ComponentProps<typeof ActivityRow>> = {}) {
  return render(
    <ActivityFeed label="Recent alerts">
      <ActivityRow icon={<svg data-testid="chip-glyph" />} timeLabel="2m ago" {...props}>
        <ActivitySubject>Salmon fillet</ActivitySubject> below reorder point (320g left)
      </ActivityRow>
    </ActivityFeed>,
  );
}

describe("ActivityRow — the three zones of the row", () => {
  it("renders the sentence with its subject promoted, not as a separate line", () => {
    renderFeed();
    const row = screen.getByRole("listitem");
    // One continuous sentence: the subject is INSIDE it, which is why `children` is a ReactNode.
    expect(row).toHaveTextContent("Salmon fillet below reorder point (320g left)");
    expect(within(row).getByText("Salmon fillet").tagName).toBe("STRONG");
  });

  it("pins the caller's already-formatted time to the end of the row", () => {
    renderFeed();
    expect(screen.getByText("2m ago")).toHaveAttribute("data-slot", "activity-time");
  });

  it("renders the chip glyph the caller supplied and hides it from assistive tech", () => {
    renderFeed();
    expect(screen.getByTestId("chip-glyph")).toBeInTheDocument();
    const chip = document.querySelector('[data-slot="activity-icon"]');
    expect(chip).toHaveAttribute("aria-hidden", "true");
  });

  it("puts the rows in a named list so a feed is one object to a screen reader", () => {
    renderFeed();
    expect(screen.getByRole("list", { name: "Recent alerts" })).toBeInTheDocument();
  });
});

describe("ActivityRow — the timestamp is never computed here", () => {
  it("reads no clock: no Date.now, no new Date, no toLocale* in the file", () => {
    expect(SOURCE).not.toMatch(/Date\.now|new Date\(|toLocale/);
  });

  it("ships no duplicate elapsed formatter and no live ticker", () => {
    // A sibling owns `lib/format/elapsed.ts`. Two implementations is how the KDS got its
    // unbounded `113h 52m`, and would be how a second one drifts from the first.
    expect(SOURCE).not.toMatch(/getTime|setInterval|setTimeout|elapsed/i);
  });

  it("degrades to a span when there is no instant, rather than an invalid bare <time>", () => {
    renderFeed();
    expect(screen.getByText("2m ago").tagName).toBe("SPAN");
  });

  it("carries the precise instant as <time dateTime> without rendering anything from it", () => {
    renderFeed({ dateTime: "2026-08-21T09:14:00.000Z" });
    const el = screen.getByText("2m ago");
    expect(el.tagName).toBe("TIME");
    expect(el).toHaveAttribute("dateTime", "2026-08-21T09:14:00.000Z");
    // The visible text is still the caller's label — nothing is derived from the instant, which
    // is what makes the row hydration-safe.
    expect(el).toHaveTextContent("2m ago");
  });
});

describe("ActivityRow — tone", () => {
  it("defaults to neutral: a row that declares no severity claims none", () => {
    renderFeed();
    expect(screen.getByRole("listitem")).toHaveAttribute("data-tone", "neutral");
  });

  it("gives every state tone a word as well as a hue (D-38-13)", () => {
    for (const [tone, word] of [
      ["danger", "Critical"],
      ["warning", "Warning"],
      ["success", "Completed"],
      ["info", "Information"],
    ] as const) {
      const view = renderFeed({ tone });
      expect(screen.getByRole("listitem")).toHaveTextContent(word);
      view.unmount();
    }
  });

  it("keeps the categorical tones silent — they mean a kind, not a severity", () => {
    for (const tone of ["accent", "secondary", "neutral"] as const) {
      const view = renderFeed({ tone });
      expect(screen.getByRole("listitem")).not.toHaveTextContent(
        /Critical|Warning|Completed|Information/,
      );
      view.unmount();
    }
  });

  it("lets a caller name a categorical tone, and silence a state one with an empty string", () => {
    const named = renderFeed({ tone: "secondary", toneLabel: "Front of house" });
    expect(screen.getByRole("listitem")).toHaveTextContent("Front of house");
    named.unmount();

    renderFeed({ tone: "danger", toneLabel: "" });
    expect(screen.getByRole("listitem")).not.toHaveTextContent("Critical");
  });

  it("names the teal by its ramp, never by the word the G3 scanner counts", () => {
    // D-38-12 consequence 4: `bg-teal-\d{2,3}` is a raw-palette offender; the namespace is
    // `secondary-*`. Asserted on the source because the class never resolves in jsdom.
    expect(SOURCE).toMatch(/bg-secondary-500\/10/);
    expect(SOURCE).not.toMatch(/teal/i);
  });

  it("never uses bg-primary as a fill — --primary is the TEXT role and renders bronze in light", () => {
    expect(SOURCE).not.toMatch(/\bbg-primary\b(?!\/)/);
    expect(SOURCE).toMatch(/bg-primary\/10/);
  });
});

describe("ActivityRow — interaction and zones", () => {
  it("is a real anchor when it links, so it is keyboard reachable without an onClick div", () => {
    renderFeed({ href: "/app/inventory/ingredients/42" });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/app/inventory/ingredients/42");
    expect(link.className).toContain("focus-visible:bg-surface-2");
    // 44px minimum: D-38-15 records the demo's 22-38px controls as a NEGATIVE reference.
    expect(link.className).toContain("min-h-11");
  });

  it("renders no interactive element at all when there is nothing to open", () => {
    renderFeed();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("has no onClick escape hatch — a div with a handler is not a control", () => {
    expect(SOURCE).not.toMatch(/onClick|onSelect/);
  });

  it("spends a hover transition in restrained/expressive and none on an operational surface", () => {
    const restrained = render(
      <ZoneProvider zone="restrained">
        <ActivityFeed label="Recent alerts">
          <ActivityRow icon={<svg />} timeLabel="2m ago" href="/x">
            ok
          </ActivityRow>
        </ActivityFeed>
      </ZoneProvider>,
    );
    expect(screen.getByRole("link").className).toContain("transition-colors");
    restrained.unmount();

    render(
      <ZoneProvider zone="operational">
        <ActivityFeed label="Recent alerts">
          <ActivityRow icon={<svg />} timeLabel="2m ago" href="/x">
            ok
          </ActivityRow>
        </ActivityFeed>
      </ZoneProvider>,
    );
    const operational = screen.getByRole("link");
    expect(operational.className).not.toContain("transition");
    expect(screen.getByRole("listitem")).toHaveAttribute("data-zone", "operational");
  });

  it("carries no forbidden richness anywhere in the file (D-38-04)", () => {
    expect(SOURCE).not.toMatch(
      /backdrop-blur|backdrop-filter|animate-|rotate-|perspective|scale-1/,
    );
  });
});

describe("ActivityRow — born on-contract (G1-G4)", () => {
  // A file absent from the conformance baseline must score ZERO. This asserts it at the source of
  // the change instead of waiting for the repo-wide gate to name it, so the failure arrives with
  // the diff that caused it.
  it("scores zero on all four gates", () => {
    expect(countMatches(SOURCE, TYPE_SCALE)).toBe(0);
    expect(countMatches(SOURCE, BARE_ROUNDED)).toBe(0);
    expect(countMatches(SOURCE, RAW_PALETTE)).toBe(0);
    expect(countMatches(SOURCE, HAND_ROLLED_TABLE)).toBe(0);
  });

  it("uses the contract type roles for both text tiers", () => {
    expect(SOURCE).toMatch(/text-small/);
    expect(SOURCE).toMatch(/text-label/);
  });

  it("formats no money itself — MoneyDisplay owns that, and paisa are BIGINT", () => {
    expect(SOURCE).not.toMatch(/toFixed|Intl\.NumberFormat|paisa|PKR|Rs\b/);
  });
});
