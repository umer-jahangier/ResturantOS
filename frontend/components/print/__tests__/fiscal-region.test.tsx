import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { FiscalRegion } from "@/components/print/fiscal-region";
import type { PrintFiscal } from "@/lib/models/print.model";

const EMPTY: PrintFiscal = {
  fbrInvoiceNumber: null,
  qrPayload: null,
  qrSizeMm: null,
  logoAssetId: null,
  noticeLine: null,
};

describe("FiscalRegion (D-26-03: reserved now, populated by Phase 27)", () => {
  it("renders NOTHING for a null region — no wrapper, no border, no whitespace node", () => {
    const { container } = render(<FiscalRegion fiscal={null} />);
    // "Collapses cleanly" is definition-of-done item 5. A stray empty wrapper leaves a visible
    // gap on 80 mm paper, so the assertion is on child count, not on visibility.
    expect(container.childNodes).toHaveLength(0);
    expect(container.innerHTML).toBe("");
  });

  it("renders NOTHING for the declared-but-entirely-empty region this phase actually produces", () => {
    // 26-03's assembler leaves every fiscal field null. That must print exactly like an absent
    // region, or every receipt issued before Phase 27 carries a blank box.
    const { container } = render(<FiscalRegion fiscal={EMPTY} />);
    expect(container.childNodes).toHaveLength(0);
  });

  it("renders the invoice number under a label, with no QR area, when there is no payload", () => {
    const { container, getByText, queryByTestId } = render(
      <FiscalRegion fiscal={{ ...EMPTY, fbrInvoiceNumber: "7000007DI1747300500123" }} />,
    );

    expect(getByText("FBR Invoice No.")).toBeInTheDocument();
    expect(getByText("7000007DI1747300500123")).toBeInTheDocument();
    expect(queryByTestId("fbr-qr-reserved")).toBeNull();
    expect(container.childNodes.length).toBeGreaterThan(0);
  });

  it("reserves a square from the region's own millimetre value, with an explicit unavailable state", () => {
    const { getByTestId, getByText } = render(
      <FiscalRegion
        fiscal={{ ...EMPTY, qrPayload: "FBR|7000007DI1747300500123", qrSizeMm: 25.4 }}
      />,
    );

    const reserved = getByTestId("fbr-qr-reserved");
    expect(reserved).toHaveAttribute("data-qr-size-mm", "25.4");
    // MILLIMETRES, not pixels. A pixel is a screen unit and this is a physical-size legal
    // requirement — 1.0 x 1.0 inch is 25.4 mm at every resolution.
    expect(reserved.getAttribute("style")).toContain("25.4mm");

    // Never a blank square: on a tax invoice that is indistinguishable from a printing fault.
    expect(getByText("QR code unavailable")).toBeInTheDocument();
  });

  it("defaults the reserved square to the specification's one inch when no size is given", () => {
    const { getByTestId } = render(
      <FiscalRegion fiscal={{ ...EMPTY, qrPayload: "opaque", qrSizeMm: null }} />,
    );
    expect(getByTestId("fbr-qr-reserved")).toHaveAttribute("data-qr-size-mm", "25.4");
  });

  it("renders the notice line", () => {
    const { getByText } = render(
      <FiscalRegion
        fiscal={{ ...EMPTY, noticeLine: "Verify this invoice with the FBR Tax Asaan app." }}
      />,
    );
    expect(getByText("Verify this invoice with the FBR Tax Asaan app.")).toBeInTheDocument();
  });
});
