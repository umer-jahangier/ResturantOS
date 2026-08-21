import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { InsetRow } from "@/components/ui/inset-row";
import { MoneyDisplay } from "@/components/ui/money-display";
import { StatusBadge } from "@/components/ui/status-badge";
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
 * `InsetRow` — the demo's 21× unnamed bordered tile, given a name (N3).
 *
 * The gates the product-wide conformance suite runs are re-run HERE against this one file, so
 * a violation is reported by the component's own suite naming the component, rather than by a
 * theme test naming a path. `conformance.test.ts` proves the file is absent from the baseline
 * and must score zero; this proves the same thing where the author is looking.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * 1. Changed the primary line's `text-body` to `text-sm` → "G1 type scale" red here
 *    ("expected 1 to be 0") AND `conformance.test.ts` red with
 *    "components/ui/inset-row.tsx: 1" under new offenders. Restored.
 * 2. Changed `bg-surface-2` to `bg-slate-800` → "G3 raw palette literals" red. Restored.
 * 3. Changed `rounded-lg` to a bare `rounded` → "G2 bare rounded" red. Restored.
 * 4. Replaced the `<button>` branch with `<div onClick={onSelect}>` — the demo's own markup —
 *    → FIVE red at once: real button, keyboard reachability, accessible name, `disabled`, and
 *    "the li owns the control". That is the shape of the defect: swapping the element does not
 *    break one thing, it breaks the whole interaction contract silently. Restored.
 * 5. Dropped the `<li>` wrapper around an interactive `as="li"` row → "a clickable row stays a
 *    list item" red. Restored.
 */

const SOURCE = stripComments(
  readFileSync(resolve(frontendRoot(), "components/ui/inset-row.tsx"), "utf8"),
);

describe("InsetRow — slots", () => {
  it("renders the four slots, and each is optional except the primary line", () => {
    render(
      <InsetRow
        leading={<span data-testid="lead">◆</span>}
        primary="PO-1094"
        secondary="Ocean Fresh Co. · Salmon 4kg + Prawns 2kg"
        trailing={<span data-testid="trail">Pending</span>}
      />,
    );
    expect(screen.getByText("PO-1094")).toBeInTheDocument();
    expect(screen.getByText("Ocean Fresh Co. · Salmon 4kg + Prawns 2kg")).toBeInTheDocument();
    expect(screen.getByTestId("lead")).toBeInTheDocument();
    expect(screen.getByTestId("trail")).toBeInTheDocument();
  });

  it("renders with the primary line alone", () => {
    render(<InsetRow primary="Branch 1 — Main" data-testid="row" />);
    const row = screen.getByTestId("row");
    expect(row).toHaveTextContent("Branch 1 — Main");
    expect(row.querySelector('[data-slot="inset-row-secondary"]')).toBeNull();
    expect(row.querySelector('[data-slot="inset-row-trailing"]')).toBeNull();
  });

  it("stays unopinionated about content — a badge and an amount drop into the slots unchanged", () => {
    // The point of the primitive: it never learns what a purchase order is. Money in
    // particular is rendered by MoneyDisplay, never by this component.
    render(
      <InsetRow
        primary="PO-1093"
        secondary="Green Gardens"
        trailing={
          <span>
            <StatusBadge status="pending" />
            <MoneyDisplay paisa={18400n} />
          </span>
        }
        data-testid="row"
      />,
    );
    const trailing = within(screen.getByTestId("row")).getByText("Rs 184.00");
    expect(trailing).toBeInTheDocument();
    expect(SOURCE).not.toMatch(/toLocaleString|Intl\.NumberFormat|formatPaisa/);
  });

  it("renders a footer on a static row", () => {
    render(<InsetRow primary="PO-1092" footer={<button type="button">Confirm</button>} />);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });
});

describe("InsetRow — semantics and keyboard", () => {
  it("is inert by default: a tile with no handler exposes no interactive role", () => {
    render(<InsetRow primary="Weekend Double Points" data-testid="row" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("an interactive row is a real button, not a div with onClick", async () => {
    const onSelect = vi.fn();
    render(<InsetRow primary="Profit & Loss Statement" onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: /Profit & Loss Statement/ });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.setup().click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("is reachable by keyboard and activates on Enter", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<InsetRow primary="Balance Sheet" onSelect={onSelect} />);
    await user.tab();
    expect(screen.getByRole("button", { name: /Balance Sheet/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("carries a focus-visible treatment rather than relying on the UA default alone", () => {
    render(<InsetRow primary="Cash Flow" onSelect={vi.fn()} data-testid="row" />);
    expect(screen.getByTestId("row").className).toContain("focus-visible:border-ring");
  });

  it("takes an explicit accessible name when the visible line is not a complete one", () => {
    render(
      <InsetRow primary="AP Aging" onSelect={vi.fn()} actionLabel="Generate AP Aging report" />,
    );
    expect(screen.getByRole("button", { name: "Generate AP Aging report" })).toBeInTheDocument();
  });

  it("does not fire while disabled", async () => {
    const onSelect = vi.fn();
    render(<InsetRow primary="Food Cost" onSelect={onSelect} disabled />);
    const button = screen.getByRole("button", { name: /Food Cost/ });
    expect(button).toBeDisabled();
    await userEvent.setup().click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders a real link when given an href", () => {
    render(<InsetRow primary="Vendor Spend" href="/app/reports/vendor-spend" />);
    expect(screen.getByRole("link", { name: /Vendor Spend/ })).toHaveAttribute(
      "href",
      "/app/reports/vendor-spend",
    );
  });
});

describe("InsetRow — composition", () => {
  it("becomes a list item on request, so a run of tiles is a real list", () => {
    render(
      <ul>
        <InsetRow as="li" primary="Shift A" />
        <InsetRow as="li" primary="Shift B" />
      </ul>,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("a clickable row stays a list item — the li owns the control", () => {
    render(
      <ul>
        <InsetRow as="li" primary="Shift A" onSelect={vi.fn()} />
      </ul>,
    );
    const item = screen.getByRole("listitem");
    expect(within(item).getByRole("button", { name: /Shift A/ })).toBeInTheDocument();
  });

  it("accepts richness through className rather than owning it", () => {
    // D-38-04: depth is the caller's decision, because only the caller knows its zone.
    render(<InsetRow primary="Branch 2" className="shadow-depth-1" data-testid="row" />);
    expect(screen.getByTestId("row").className).toContain("shadow-depth-1");
  });

  it("is safe on the operational zone by default — no glass, no entrance motion, no tilt", () => {
    // D-38-04 permits depth cues ONLY on POS/KDS surfaces. A primitive that had to be
    // switched off to be safe there would be switched off wrongly at least once.
    expect(SOURCE).not.toMatch(
      /glass-surface|backdrop-(?:filter|blur)|vdl-(?:enter|reveal|tilt|lift|stagger)/,
    );
  });
});

describe("InsetRow — selection is never colour alone (D-38-13)", () => {
  it("publishes aria-current and a thickness channel, not just a hue", () => {
    render(<InsetRow primary="Branch 1 — Main" selected data-testid="row" />);
    const row = screen.getByTestId("row");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveAttribute("data-selected", "true");
    // The ring makes the selected tile measurably thicker than its neighbours, which reads in
    // greyscale. Colour (`border-primary`) is the second channel, not the only one.
    expect(row.className).toContain("ring-2");
  });

  it("marks nothing when not selected", () => {
    render(<InsetRow primary="Branch 2" data-testid="row" />);
    expect(screen.getByTestId("row")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("row").className).not.toContain("ring-2");
  });

  it("uses the DECORATIVE border tier, not the interactive one", () => {
    // D-38-13: `--border-interactive` is reserved for controls whose boundary is the only
    // thing marking them. A tile has a fill, a radius and content; 21 of them shouting at
    // 3:1 is the failure the split exists to prevent.
    expect(SOURCE).toContain("border-border");
    expect(SOURCE).not.toContain("border-interactive");
  });
});

describe("InsetRow — born on-contract (gates G1–G4)", () => {
  it("G1 type scale: uses the contract roles, never Tailwind's stock sizes", () => {
    expect(countMatches(SOURCE, TYPE_SCALE), "text-xs|sm|base|lg|xl|2xl|3xl").toBe(0);
    expect(SOURCE).toMatch(/\btext-body\b/);
    expect(SOURCE).toMatch(/\btext-small\b/);
  });

  it("G2 radius: on the ladder, never a bare `rounded`", () => {
    expect(countMatches(SOURCE, BARE_ROUNDED), "bare rounded").toBe(0);
    expect(SOURCE).toMatch(/\brounded-lg\b/);
  });

  it("G3 colour: semantic tokens only, no raw palette literals", () => {
    expect(countMatches(SOURCE, RAW_PALETTE), "raw palette literals").toBe(0);
  });

  it("G4: rolls no table of its own", () => {
    expect(countMatches(SOURCE, HAND_ROLLED_TABLE), "hand-rolled <table>").toBe(0);
  });

  it("solid fills would use the FILL role, and this file declares none", () => {
    // `--primary` is the TEXT/LINK role (bronze in light); `--primary-solid` is the fill.
    // The tile has no solid fill at all, so the only correct count for both is zero-ish:
    // primary appears solely as a border/ring tint, which is what `--primary` is for.
    expect(SOURCE).not.toMatch(/\bbg-primary\b/);
  });

  it("takes plain props: it does not fetch, and imports no hook that does", () => {
    // ESLint enforces the layer boundary for api-client/repositories; this covers the other
    // half — a presentation primitive that reaches for a query hook is no longer a primitive.
    expect(SOURCE).not.toMatch(/from "@\/lib\/(?:hooks|repositories|api-client)/);
    expect(SOURCE).not.toMatch(/useQuery|useMutation|fetch\(/);
  });
});
