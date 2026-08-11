import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClaimCallout } from "@/components/finance/guide/ClaimCallout";
import { GuideTab } from "@/components/finance/guide/GuideTab";
import { allClaims } from "@/lib/finance/guide/claims";
import { allGuideTabs } from "@/lib/finance/guide/tabs";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("GuideTab — one section per finance tab, four answers each", () => {
  it("renders a section for every tab the guide holds", () => {
    render(<GuideTab />);
    for (const tab of allGuideTabs()) {
      expect(screen.getByTestId(`guide-section-${tab.anchor}`)).toBeInTheDocument();
    }
  });

  it("answers D-37-03's four questions in every section, in its order", () => {
    render(<GuideTab />);
    const section = screen.getByTestId("guide-section-takings");
    const terms = within(section)
      .getAllByRole("term")
      .map((t) => t.textContent);
    expect(terms).toEqual([
      "What it is",
      "When you use it",
      "What a typical entry looks like",
      "What it affects elsewhere",
    ]);
  });

  it("names other tabs in the downstream answer, so the module reads as one system", () => {
    render(<GuideTab />);
    // Takings must point somewhere other than itself, or the paragraph is just a restatement.
    const takings = screen.getByTestId("guide-section-takings");
    expect(takings).toHaveTextContent("Transactions");
    const transactions = screen.getByTestId("guide-section-transactions");
    expect(transactions).toHaveTextContent("Takings");
  });

  it("gives every section a stable anchor a screen can deep-link to", () => {
    render(<GuideTab />);
    for (const tab of allGuideTabs()) {
      expect(screen.getByTestId(`guide-section-${tab.anchor}`)).toHaveAttribute("id", tab.anchor);
    }
    // And the jump list points at each one.
    const nav = screen.getByRole("navigation", { name: "Sections" });
    for (const tab of allGuideTabs()) {
      expect(within(nav).getByRole("link", { name: tab.label })).toHaveAttribute(
        "href",
        `#${tab.anchor}`,
      );
    }
  });

  it("nests headings without skipping a level — h2 per tab, h3 for its rules", () => {
    render(<GuideTab />);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(allGuideTabs().length);
    // No h1 inside the component; the route owns the page title.
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    const withClaims = allGuideTabs().filter((t) => t.claims.length > 0);
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBe(withClaims.length);
  });

  it("places the four support-ticket rules where an owner meets them", () => {
    render(<GuideTab />);
    const inSection = (anchor: string, claimId: string) =>
      within(screen.getByTestId(`guide-section-${anchor}`))
        .queryAllByTestId("claim-callout")
        .some((el) => el.getAttribute("data-claim-id") === claimId);

    expect(inSection("takings", "FIN-GUIDE-0001")).toBe(true);
    expect(inSection("periods", "FIN-GUIDE-0002")).toBe(true);
    expect(inSection("journal-entries", "FIN-GUIDE-0002")).toBe(true);
    expect(inSection("gl", "FIN-GUIDE-0003")).toBe(true);
    expect(inSection("periods", "FIN-GUIDE-0004")).toBe(true);
  });
});

describe("ClaimCallout — a sentence with no registry row has no path to the page", () => {
  it("renders the registry's words verbatim, not a paraphrase", () => {
    const claim = allClaims()[0]!;
    render(<ClaimCallout id={claim.id} />);
    expect(screen.getByTestId("claim-callout")).toHaveTextContent(claim.claim);
    expect(screen.getByTestId("claim-callout")).toHaveTextContent(claim.why!);
  });

  it("says how many tests defend the sentence — the reason to believe it", () => {
    const claim = allClaims().find((c) => c.assertedBy.length > 1)!;
    render(<ClaimCallout id={claim.id} />);
    expect(screen.getByTestId("claim-callout")).toHaveTextContent(
      `Checked by ${claim.assertedBy.length} tests`,
    );
  });

  it("makes an unregistered id LOUD rather than silently rendering nothing", () => {
    // A missing rule that renders as a blank is the failure mode this whole mechanism exists to
    // prevent: the reader is not told the rule is gone, they are simply never told the rule.
    render(<ClaimCallout id="FIN-GUIDE-9999" />);
    const alert = screen.getByTestId("claim-missing");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("FIN-GUIDE-9999");
  });

  it("renders ONLY registry text — every callout on the page traces to a row", () => {
    render(<GuideTab />);
    const known = new Set(allClaims().map((c) => c.id));
    const rendered = screen.getAllByTestId("claim-callout");
    expect(rendered.length).toBeGreaterThan(0);
    for (const el of rendered) {
      expect(known.has(el.getAttribute("data-claim-id")!)).toBe(true);
    }
    expect(screen.queryByTestId("claim-missing")).not.toBeInTheDocument();
  });
});

describe("the guide's register — written for an owner, not an accountant", () => {
  /**
   * A blunt instrument, and deliberately so. It cannot judge whether prose is readable; it CAN
   * catch the specific vocabulary D-37-03 rules out by name, which is the failure that actually
   * happens when someone writes a section in a hurry.
   */
  const JARGON = [
    "normalised",
    "normalized",
    "ledger account hierarchy",
    "double-entry",
    "accrual",
    "chart of accounts hierarchy",
    "contra-revenue",
    "idempotent",
    "foreign key",
    "denormalis",
  ];

  it("uses none of the words D-37-03 rules out", () => {
    const prose = allGuideTabs()
      .flatMap((t) => [t.oneLiner, t.whatItIs, t.whenYouUseIt, t.typicalEntry, t.affectsDownstream])
      .concat(allClaims().flatMap((c) => [c.claim, c.why ?? ""]))
      .join(" ")
      .toLowerCase();

    const found = JARGON.filter((word) => prose.includes(word));
    expect(found, "the guide is written for a restaurant owner — rephrase these").toEqual([]);
  });

  it("leads a claim with the behaviour, not with a status code", () => {
    // D-37-03: "the number belongs in the detail, not in the first line."
    for (const claim of allClaims()) {
      expect(
        /^\s*\d{3}\b/.test(claim.claim),
        `${claim.id} opens with a status code`,
      ).toBe(false);
    }
  });
});
