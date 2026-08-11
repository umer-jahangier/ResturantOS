import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { KdsTicketCard } from "@/components/kds/kds-ticket-card";
import { formatAge, getAgingTreatment } from "@/components/kds/kds-aging";
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
    receivedAt: new Date(Date.now() - 5 * 60_000),
    startedAt: null,
    readyAt: null,
    orderNotes: null,
    tableNumber: "12",
    orderType: null,
    items: [makeItem()],
    ...overrides,
  };
}

/** 5 min old vs a 900s threshold = 0.33 — fresh. */
const FRESH = { receivedAt: new Date(Date.now() - 5 * 60_000), threshold: 900 };
/** 7 min old vs a 600s threshold = 0.70 — warn. */
const WARN = { receivedAt: new Date(Date.now() - 7 * 60_000), threshold: 600 };
/** 12 min old vs a 600s threshold = 1.20 — late. */
const LATE = { receivedAt: new Date(Date.now() - 12 * 60_000), threshold: 600 };

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

describe("formatAge", () => {
  it("is mm:ss, per the §7.2 ticket face", () => {
    expect(formatAge(6 * 60_000 + 12_000)).toBe("06:12");
    expect(formatAge(0)).toBe("00:00");
    expect(formatAge(59_000)).toBe("00:59");
  });

  it("becomes h:mm:ss past an hour rather than running the minute field to four digits", () => {
    // A four-day-old seeded ticket rendered "5772:14" — noise, not a number, at two metres.
    expect(formatAge(4 * 3600_000 + 5 * 60_000 + 3_000)).toBe("4:05:03");
  });
});
