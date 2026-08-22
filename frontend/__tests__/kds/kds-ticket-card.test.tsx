import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { KdsTicketCard } from "@/components/kds/kds-ticket-card";
import { getAgingTreatment } from "@/components/kds/kds-aging";
import type { KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";

/**
 * kds-ticket-card.test.tsx — phase-21 rewrite.
 *
 * The pre-21 version asserted `border-l-emerald-500/60`, `border-l-amber-500`,
 * `border-l-red-500` and `chip.className).toContain("amber")`. Those assertions were
 * load-bearing in the wrong direction: they pinned the card to a hard-coded Tailwind palette
 * that UI-SPEC §3.7 replaced, and — worse — they encoded COLOUR AS THE ENCODING. A card that
 * satisfied the old suite could still be unreadable to a protanope, because the old suite's
 * definition of "shows the ticket is late" was "the class string contains the word red".
 *
 * What is asserted now is the CONTRACT: three redundant channels, each independently
 * sufficient, plus a fill change for late (§3.7). The tests below would fail if every colour
 * token in the file were replaced with the same grey.
 */

/**
 * One fixed `now` for the whole file, and the KDS clock is mocked to it.
 *
 * Never the wall clock. `__tests__/kds/kds-clear-stale.test.tsx` hardcoded an instant against a
 * live clock and was red from 2026-08-13 onward without a line of source changing; every instant
 * below is derived from this constant, so there is no second clock to drift against.
 */
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);

vi.mock("@/lib/hooks/kds/use-kds-clock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks/kds/use-kds-clock")>();
  return { ...actual, useKdsClock: () => NOW };
});

function makeItem(overrides: Partial<KdsTicketItem> = {}): KdsTicketItem {
  return {
    id: "d0000001-0000-4000-8000-000000000001",
    orderItemId: "d0000002-0000-4000-8000-000000000002",
    name: "Chicken Karahi",
    qty: 2,
    modifiers: ["Extra Spicy"],
    notes: null,
    status: "PENDING",
    revisionNo: 1,
    firedAt: null,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<KdsTicket> = {}): KdsTicket {
  return {
    id: "d0000003-0000-4000-8000-000000000003",
    orderId: "d0000004-0000-4000-8000-000000000004",
    orderNo: "ORD-001",
    stationCode: "GRILL",
    status: "PENDING",
    priority: false,
    receivedAt: new Date(NOW - 5 * 60_000),
    startedAt: null,
    readyAt: null,
    clearedAt: null,
    orderNotes: null,
    tableNumber: "12",
    orderType: null,
    items: [makeItem()],
    ...overrides,
  };
}

/** 5 min old vs a 900s threshold = 0.33 — fresh. */
const FRESH = { receivedAt: new Date(NOW - 5 * 60_000), threshold: 900 };
/** 7 min old vs a 600s threshold = 0.70 — warn. */
const WARN = { receivedAt: new Date(NOW - 7 * 60_000), threshold: 600 };
/** 12 min old vs a 600s threshold = 1.20 — late. */
const LATE = { receivedAt: new Date(NOW - 12 * 60_000), threshold: 600 };

describe("KdsTicketCard — the ticket face (UI-SPEC §7.2)", () => {
  it("renders ONE LINE PER ITEM, not a comma-joined truncated string", () => {
    const ticket = makeTicket({
      items: [
        makeItem({ id: "i1", name: "Chicken Karahi", qty: 2, modifiers: [] }),
        makeItem({ id: "i2", name: "Garlic Naan", qty: 1, modifiers: [] }),
        makeItem({ id: "i3", name: "Raita", qty: 3, modifiers: [] }),
      ],
    });

    render(<KdsTicketCard ticket={ticket} />);
    const card = screen.getByTestId("kds-ticket-card");

    // Each item has its own list row — the pre-21 card put all three in one <div>.
    expect(within(card).getByTestId("kds-item-i1")).toBeInTheDocument();
    expect(within(card).getByTestId("kds-item-i2")).toBeInTheDocument();
    expect(within(card).getByTestId("kds-item-i3")).toBeInTheDocument();
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);

    // And no comma-joined blob survives anywhere.
    expect(card.textContent).not.toMatch(/Chicken Karahi,\s*1× Garlic Naan/);
  });

  it("renders modifiers ON THEIR OWN ITEM, never merged into a shared notes line", () => {
    const ticket = makeTicket({
      items: [
        makeItem({ id: "i1", name: "Chicken Karahi", modifiers: ["no chilli", "extra gravy"] }),
        makeItem({ id: "i2", name: "Garlic Naan", modifiers: [] }),
      ],
    });

    render(<KdsTicketCard ticket={ticket} />);

    const karahi = screen.getByTestId("kds-item-i1");
    expect(within(karahi).getByTestId("kds-item-modifiers-i1")).toHaveTextContent(
      "no chilli, extra gravy",
    );
    // The naan must not inherit the karahi's modifiers. This is how an allergy gets cooked.
    expect(screen.queryByTestId("kds-item-modifiers-i2")).not.toBeInTheDocument();
  });

  it("renders item notes as a distinct block, separate from the modifier line", () => {
    const ticket = makeTicket({
      items: [makeItem({ id: "i1", modifiers: ["extra gravy"], notes: "Allergy: nuts" })],
    });

    render(<KdsTicketCard ticket={ticket} />);

    expect(screen.getByTestId("kds-item-modifiers-i1")).toHaveTextContent("extra gravy");
    expect(screen.getByTestId("kds-item-notes-i1")).toHaveTextContent("Allergy: nuts");
  });

  it("shows the position number that makes number-key jump meaningful", () => {
    render(<KdsTicketCard ticket={makeTicket()} positionNumber={7} />);

    const position = screen.getByTestId("kds-ticket-position");
    expect(position).toHaveTextContent("7");
    expect(position).toHaveAttribute("aria-label", "Ticket position 7");
  });

  it("omits the position number past the tenth ticket rather than showing a meaningless one", () => {
    render(<KdsTicketCard ticket={makeTicket()} />);

    expect(screen.queryByTestId("kds-ticket-position")).not.toBeInTheDocument();
  });

  it("marks the focused ticket distinctly from an unfocused one", () => {
    const { rerender } = render(<KdsTicketCard ticket={makeTicket()} />);
    expect(screen.getByTestId("kds-ticket-card")).not.toHaveAttribute("data-focused");

    rerender(<KdsTicketCard ticket={makeTicket()} isFocused />);
    expect(screen.getByTestId("kds-ticket-card")).toHaveAttribute("data-focused", "true");
  });

  it("still shows order number, table and a PRIORITY flag", () => {
    const ticket = makeTicket({ orderNo: "ORD-042", tableNumber: "9", priority: true });

    render(<KdsTicketCard ticket={ticket} />);
    const card = screen.getByTestId("kds-ticket-card");

    expect(within(card).getByText("ORD-042")).toBeInTheDocument();
    expect(within(card).getByText(/Table 9/)).toBeInTheDocument();
    expect(within(card).getByText("PRIORITY")).toBeInTheDocument();
  });

  it('shows "No table" for a takeaway ticket', () => {
    render(<KdsTicketCard ticket={makeTicket({ tableNumber: null })} />);

    expect(screen.getByText("No table")).toBeInTheDocument();
  });

  it("respects an `items` override — a column fragment shows only its own subset", () => {
    const burger = makeItem({ id: "i1", name: "Burger", status: "PREPARING" });
    const fries = makeItem({ id: "i2", name: "Fries", status: "ACCEPTED" });

    render(<KdsTicketCard ticket={makeTicket({ items: [burger, fries] })} items={[fries]} />);
    const card = screen.getByTestId("kds-ticket-card");

    expect(within(card).getByText("Fries")).toBeInTheDocument();
    expect(within(card).queryByText("Burger")).not.toBeInTheDocument();
  });

  it("opens no dialog — selecting a card is the caller's job (it routes to a page)", () => {
    render(<KdsTicketCard ticket={makeTicket()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("KdsTicketCard — ageing carries THREE redundant channels (UI-SPEC §3.7)", () => {
  it.each([
    ["fresh", FRESH, 2, ""],
    ["warn", WARN, 4, "DUE"],
    ["late", LATE, 6, "LATE"],
  ] as const)(
    "%s: border width %s px, and the chip carries the word %s",
    (state, fixture, borderPx, word) => {
      const ticket = makeTicket({ receivedAt: fixture.receivedAt });

      render(<KdsTicketCard ticket={ticket} escalationThresholdSeconds={fixture.threshold} />);
      const card = screen.getByTestId("kds-ticket-card");
      const chip = within(card).getByTestId("kds-ticket-age");

      // The state itself, machine-readable — what the greyscale e2e check asserts on.
      expect(card).toHaveAttribute("data-aging", state);

      // CHANNEL 1 — geometry. Survives greyscale and every CVD simulation.
      expect(card.style.borderLeftWidth).toBe(`${borderPx}px`);

      // CHANNEL 3 — the literal word. Survives a monochrome display.
      if (word) {
        expect(chip).toHaveTextContent(word);
      } else {
        expect(chip).not.toHaveTextContent(/DUE|LATE/);
      }
    },
  );

  it("uses a DIFFERENT ICON per state — three shapes, not one shape in three colours", () => {
    const icons = new Set<string>();

    for (const fixture of [FRESH, WARN, LATE]) {
      const { unmount } = render(
        <KdsTicketCard
          ticket={makeTicket({ receivedAt: fixture.receivedAt })}
          escalationThresholdSeconds={fixture.threshold}
        />,
      );
      const svg = screen.getByTestId("kds-ticket-age").querySelector("svg");
      // lucide stamps the icon name into the class list — a stable identity for the SHAPE.
      icons.add(svg?.getAttribute("class") ?? "");
      unmount();
    }

    expect(icons.size).toBe(3);
  });

  it("LATE changes the card FILL, not merely the hue — the strongest available encoding", () => {
    const { rerender } = render(
      <KdsTicketCard
        ticket={makeTicket({ receivedAt: WARN.receivedAt })}
        escalationThresholdSeconds={WARN.threshold}
      />,
    );
    expect(screen.getByTestId("kds-ticket-card").className).not.toContain("bg-kds-late-fill");

    rerender(
      <KdsTicketCard
        ticket={makeTicket({ receivedAt: LATE.receivedAt })}
        escalationThresholdSeconds={LATE.threshold}
      />,
    );
    expect(screen.getByTestId("kds-ticket-card").className).toContain("bg-kds-late-fill");
  });

  it("announces the ageing state to a screen reader, which sees none of the three channels", () => {
    render(
      <KdsTicketCard
        ticket={makeTicket({ receivedAt: LATE.receivedAt })}
        escalationThresholdSeconds={LATE.threshold}
      />,
    );

    expect(screen.getByTestId("kds-ticket-age").getAttribute("aria-label")).toMatch(/^Late —/);
  });

  it("carries NO hard-coded Tailwind palette class — every colour is a phase-20 token", () => {
    render(
      <KdsTicketCard
        ticket={makeTicket({ receivedAt: LATE.receivedAt })}
        escalationThresholdSeconds={LATE.threshold}
      />,
    );

    const html = screen.getByTestId("kds-ticket-card").outerHTML;
    expect(html).not.toMatch(
      /\b(?:bg|text|border|border-l)-(?:gray|red|amber|emerald|blue)-\d{2,3}/,
    );
  });
});

describe("getAgingTreatment — the fraction logic is unchanged from the pre-21 card", () => {
  it("stays fresh below 0.66× the station's threshold", () => {
    expect(getAgingTreatment(5 * 60_000, 900).state).toBe("fresh");
  });

  it("warns at exactly 0.66×", () => {
    expect(getAgingTreatment(0.66 * 600 * 1000, 600).state).toBe("warn");
  });

  it("is late at exactly 1.0×", () => {
    expect(getAgingTreatment(600 * 1000, 600).state).toBe("late");
  });

  it("scales with the STATION's own threshold, not a fixed 5/8-minute convention", () => {
    // The same 7-minute-old ticket is fresh at a slow station and late at a fast one.
    expect(getAgingTreatment(7 * 60_000, 1800).state).toBe("fresh");
    expect(getAgingTreatment(7 * 60_000, 300).state).toBe("late");
  });

  it("falls back to 15 minutes when the station has not loaded yet", () => {
    expect(getAgingTreatment(20 * 60_000).state).toBe("late");
    expect(getAgingTreatment(4 * 60_000).state).toBe("fresh");
  });
});

/**
 * The chip's timer, asserted on the CARD rather than on a formatter.
 *
 * `kds-aging.ts` owned a `formatAge` of its own until 38-05 — this codebase's second of three
 * disagreeing duration formatters — and the tests that used to live here asserted it directly.
 * That is the wrong place to assert: `__tests__/lib/format/elapsed.test.ts` already proves the
 * arithmetic 35 ways, and it proved it for `station-picker.tsx` too, which went on rendering
 * `Oldest 113h 52m` because it never called the module. What is worth pinning here is that THIS
 * face calls it — so these render the real card and read the string a cook reads.
 *
 * The clock is injected. A fixture that trusts the wall clock is how
 * `kds-clear-stale.test.tsx:241` went red on 2026-08-13 while nothing about the code had changed.
 */
describe("the age chip is the ONE bounded formatter, on the card", () => {
  function chipAt(agoMs: number): HTMLElement {
    render(
      <KdsTicketCard
        ticket={makeTicket({ receivedAt: new Date(NOW - agoMs) })}
        escalationThresholdSeconds={900}
      />,
    );
    return screen.getByTestId("kds-ticket-age");
  }

  it("is mm:ss under an hour, per the §7.2 ticket face", () => {
    expect(chipAt(6 * 60_000 + 12_000)).toHaveTextContent("06:12");
  });

  it("spells the units past an hour — `13:47` must not mean both 13 min and 13 h on one board", () => {
    // The deleted formatter ran `h:mm:ss` forever and rendered this as `4:05:03`.
    expect(chipAt(4 * 3_600_000 + 5 * 60_000 + 3_000)).toHaveTextContent("4h 5m");
  });

  it("STOPS COUNTING past 24 h and names the day the ticket was fired", () => {
    // A four-day-old seeded ticket rendered `5772:14` — noise, not a number, at two metres.
    // Asserted by SHAPE, not by a literal day: the exact date depends on the runner's zone,
    // and a fixture that encodes one is the same class of rot as one that reads the wall clock.
    const chip = chipAt(4 * 86_400_000 + 17 * 3_600_000);
    expect(chip.textContent).toMatch(/\d{1,2} [A-Za-z]{3}/);
    expect(chip.textContent, "past the bound the chip must not still be a timer").not.toMatch(
      /\d+:\d\d/,
    );
  });

  it("announces WORDS to a screen reader, never the chip's own `07:42`", () => {
    // Announced bare, `07:42` is read as a clock time — a different fact entirely.
    const label = chipAt(7 * 60_000 + 42_000).getAttribute("aria-label");
    expect(label).toContain("7 minutes 42 seconds");
    expect(label).not.toContain("07:42");
  });
});
