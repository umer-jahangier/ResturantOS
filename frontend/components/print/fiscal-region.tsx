import type { PrintFiscal } from "@/lib/models/print.model";

/**
 * The FBR block of a receipt — reserved now, populated by Phase 27 (D-26-03).
 *
 * <p>The whole of D-26-03 is here: the layout knows where the invoice number and the QR go, and
 * Phase 27 supplies the values. The cost of getting this wrong is a receipt redesign after tenants
 * have been handed the old layout; the cost of getting it right is a nullable field and some
 * whitespace.
 *
 * <p><b>No QR library.</b> There is none in this repository and this plan does not add one. The DI
 * specification fixes the symbol version (2.0, 25x25) and the physical size (1.0 x 1.0 inch) and
 * says NOTHING about what the symbol encodes — that is a real gap in the spec, not a gap in our
 * reading of it. So this component receives an opaque payload and reserves the space; the day
 * Phase 27 wires a generator, the difference is visible rather than silent.
 */
export function FiscalRegion({ fiscal }: { fiscal: PrintFiscal | null }) {
  // Not an empty wrapper, not a zero-height div: NOTHING. "Collapses cleanly" is
  // definition-of-done item 5, and a stray element leaves a visible gap on 80 mm paper.
  if (fiscal === null) {
    return null;
  }

  const hasInvoiceNumber = Boolean(fiscal.fbrInvoiceNumber);
  const hasQr = Boolean(fiscal.qrPayload);
  const hasNotice = Boolean(fiscal.noticeLine);

  if (!hasInvoiceNumber && !hasQr && !hasNotice) {
    // A declared-but-entirely-empty region is the shape this phase actually produces (26-03 leaves
    // every fiscal field null). It must print as nothing, exactly like a null region.
    return null;
  }

  // Millimetres, from the document's own value, defaulting to the specification's one inch.
  // Expressed as a CSS custom property so the size lives in the print stylesheet where every other
  // physical dimension does.
  const qrSizeMm = fiscal.qrSizeMm ?? 25.4;

  return (
    <section aria-label="FBR fiscal information">
      <hr className="receipt-rule" />
      {hasInvoiceNumber ? (
        <div className="receipt-center">
          <div>FBR Invoice No.</div>
          <div>{fiscal.fbrInvoiceNumber}</div>
        </div>
      ) : null}

      {hasQr ? (
        <div
          className="receipt-qr-reserved"
          style={{ ["--receipt-qr-size" as string]: `${qrSizeMm}mm` }}
          data-testid="fbr-qr-reserved"
          data-qr-size-mm={qrSizeMm}
        >
          {/*
            An explicit unavailable state, never a blank square. A blank square on a tax invoice is
            indistinguishable from a printing fault, and a customer cannot tell the difference
            between "this feature is not built yet" and "your printer is failing".
          */}
          <span>QR code unavailable</span>
        </div>
      ) : null}

      {hasNotice ? <div className="receipt-center">{fiscal.noticeLine}</div> : null}
    </section>
  );
}
