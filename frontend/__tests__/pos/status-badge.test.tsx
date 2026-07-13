import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusBadge } from "@/components/ui/status-badge";

// Data-driven over the UI-SPEC "Status System" tables: 7 line-item statuses + 7
// order-level statuses (SERVED is shared — identical icon/label/hue in both tables).

const LINE_ITEM_STATUSES: Array<{
  status: string;
  label: string;
  tokenClass: string;
}> = [
  { status: "PENDING", label: "Pending", tokenClass: "text-muted-foreground" },
  { status: "SENT", label: "Sent", tokenClass: "text-info" },
  { status: "ACCEPTED", label: "Accepted", tokenClass: "text-info" },
  { status: "PREPARING", label: "Preparing", tokenClass: "text-info" },
  { status: "READY", label: "Ready", tokenClass: "text-success" },
  { status: "SERVED", label: "Served", tokenClass: "text-success" },
  { status: "CANCELLED", label: "Cancelled", tokenClass: "text-destructive" },
];

const ORDER_STATUSES: Array<{
  status: string;
  label: string;
  tokenClass: string;
}> = [
  { status: "DRAFT", label: "Draft", tokenClass: "text-muted-foreground" },
  { status: "IN_PROGRESS", label: "In Progress", tokenClass: "text-info" },
  { status: "PARTIALLY_SERVED", label: "Partially Served", tokenClass: "text-warning" },
  { status: "SERVED", label: "Served", tokenClass: "text-success" },
  { status: "CLOSED", label: "Closed", tokenClass: "text-muted-foreground" },
  { status: "VOIDED", label: "Voided", tokenClass: "text-destructive" },
  { status: "REFUNDED", label: "Refunded", tokenClass: "text-warning" },
];

const RAW_PALETTE_PATTERN = /\b(bg|text|border)-(red|green|blue|amber|orange|emerald|slate)-\d{2,3}\b/;

describe("StatusBadge — POS/KDS Status System (UI-SPEC)", () => {
  describe.each(LINE_ITEM_STATUSES)("line-item status $status", ({ status, label, tokenClass }) => {
    it(`renders the "${label}" label with an icon and the ${tokenClass} semantic token`, () => {
      const { container } = render(<StatusBadge status={status as never} />);

      expect(screen.getByText(label)).toBeInTheDocument();

      const badge = container.querySelector("span");
      expect(badge).not.toBeNull();
      expect(badge?.className).toContain(tokenClass);
      expect(badge?.className).not.toMatch(RAW_PALETTE_PATTERN);

      // Icon + label: color is never the sole channel (WCAG, UI-SPEC Rule).
      const icon = container.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");

      // Badge itself carries an aria-label mirroring the visible text.
      expect(badge).toHaveAttribute("aria-label", label);
    });
  });

  describe.each(ORDER_STATUSES)("order status $status", ({ status, label, tokenClass }) => {
    it(`renders the "${label}" label with an icon and the ${tokenClass} semantic token`, () => {
      const { container } = render(<StatusBadge status={status as never} />);

      expect(screen.getByText(label)).toBeInTheDocument();

      const badge = container.querySelector("span");
      expect(badge?.className).toContain(tokenClass);
      expect(badge?.className).not.toMatch(RAW_PALETTE_PATTERN);

      const icon = container.querySelector("svg");
      expect(icon).not.toBeNull();
    });
  });

  it("PREPARING gets a pulse affordance (kitchen pipeline, subtle attention cue)", () => {
    const { container } = render(<StatusBadge status={"PREPARING" as never} />);
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("animate-pulse");
  });

  it("legacy generic variants (Finance) remain label-only and backward compatible", () => {
    render(<StatusBadge status="active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("a custom label overrides the default status label", () => {
    render(<StatusBadge status={"READY" as never} label="All set" />);
    expect(screen.getByText("All set")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });
});
