import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PaymentStatusBadge } from "@/components/pos/payment-status-badge";

// payment-status-badge.test.tsx — TDD RED->GREEN proof for the 4-state hue+icon+label
// payment-status chip (POS-22/23/24, 07.3-UI-SPEC "Status System deltas"). Every state
// must render BOTH its label text AND a non-decorative icon (never color-only, WCAG) —
// an unknown/unexpected status value must render a safe neutral fallback rather than
// throwing (registry safety, mirrors StatusBadge's isPosStatus() guard pattern).

describe("PaymentStatusBadge", () => {
  it("renders PAID with a check icon, success hue, and the 'Paid' label", () => {
    render(<PaymentStatusBadge status="PAID" />);
    const badge = screen.getByTestId("payment-status-badge");
    expect(badge).toHaveTextContent("Paid");
    expect(badge.className).toMatch(/success/);
    expect(badge.querySelector("svg")).toBeInTheDocument();
  });

  it("renders PARTIALLY_PAID with a half-circle icon, warning hue, and the 'Partial' label", () => {
    render(<PaymentStatusBadge status="PARTIALLY_PAID" />);
    const badge = screen.getByTestId("payment-status-badge");
    expect(badge).toHaveTextContent("Partial");
    expect(badge.className).toMatch(/warning/);
    expect(badge.querySelector("svg")).toBeInTheDocument();
  });

  it("renders UNPAID with a dot icon, neutral hue, and the 'Unpaid' label", () => {
    render(<PaymentStatusBadge status="UNPAID" />);
    const badge = screen.getByTestId("payment-status-badge");
    expect(badge).toHaveTextContent("Unpaid");
    expect(badge.className).toMatch(/muted/);
    expect(badge.querySelector("svg")).toBeInTheDocument();
  });

  it("renders REFUNDED with an undo icon, danger hue, and the 'Refunded' label", () => {
    render(<PaymentStatusBadge status="REFUNDED" />);
    const badge = screen.getByTestId("payment-status-badge");
    expect(badge).toHaveTextContent("Refunded");
    expect(badge.className).toMatch(/destructive/);
    expect(badge.querySelector("svg")).toBeInTheDocument();
  });

  it("never renders color/icon alone — every state pairs an icon with visible label text", () => {
    render(<PaymentStatusBadge status="PAID" />);
    const badge = screen.getByTestId("payment-status-badge");
    expect(badge.querySelector("svg")).toBeInTheDocument();
    expect(badge.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("renders a non-throwing neutral fallback for an unknown status value", () => {
    // Registry safety: a status value outside the known 4-state union must never crash
    // the badge (e.g. a future backend enum addition or a transient bad response).
    expect(() =>
      render(<PaymentStatusBadge status={"SOMETHING_UNEXPECTED" as never} />),
    ).not.toThrow();
    const badge = screen.getByTestId("payment-status-badge");
    expect(badge.textContent?.trim().length).toBeGreaterThan(0);
    expect(badge.querySelector("svg")).toBeInTheDocument();
  });
});
