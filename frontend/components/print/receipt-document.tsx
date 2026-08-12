import type { PrintDocument } from "@/lib/models/print.model";
import { FiscalRegion } from "@/components/print/fiscal-region";

/**
 * The 80 mm customer bill (D-26-01's plain tier).
 *
 * <h2>This component performs NO money arithmetic. None.</h2>
 *
 * <p>Every figure it prints is a string the SERVER already rendered, through the one formatter
 * D-26-04 names. It never divides a paisa value, never multiplies one, never calls a locale
 * formatter, and deliberately does NOT use `components/ui/money-display.tsx` — that component takes
 * paisa and formats, which is exactly the arithmetic that must not happen here. Naming it in this
 * comment is deliberate, so a later reader treats its absence as a decision rather than an
 * oversight.
 *
 * <p>The reason is specific. The journal-entry detail screen shipped every total one hundred times
 * too large by doing that arithmetic in a component. A receipt is the same defect with the customer
 * holding the evidence: they keep the paper, and the paper is what they will bring back.
 *
 * <h2>Design tokens</h2>
 *
 * <p>A thermal receipt is monochrome output and is deliberately exempt from the phase-20 colour
 * system. See the header of `receipt-print.css`.
 *
 * <h2>What it is not</h2>
 *
 * <p>Presentational only: no data fetching, no query hooks, no state. It renders a document the
 * server issued. A client-assembled bill could not carry an FBR number and would drift from the
 * ledger the moment pricing changed.
 */
export function ReceiptDocumentView({ document }: { document: PrintDocument }) {
  const { header, issue, totals, footer } = document;

  return (
    <div className="receipt-root" data-testid="receipt-root">
      {issue.reprint ? (
        <div className="receipt-reprint-band" data-testid="reprint-band">
          *** REPRINT #{issue.sequenceNumber} ***
          {issue.originalIssuedAt ? (
            <div>Originally issued {issue.originalIssuedAt.toISOString()}</div>
          ) : null}
        </div>
      ) : null}

      {header ? (
        <div className="receipt-center">
          {header.branchName ? <div>{header.branchName}</div> : null}
          {header.addressLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
          {header.phone ? <div>{header.phone}</div> : null}
          {header.ntn ? <div>NTN: {header.ntn}</div> : null}
          {header.strn ? <div>STRN: {header.strn}</div> : null}
        </div>
      ) : null}

      <hr className="receipt-rule" />

      <div className="receipt-row">
        <span className="receipt-row-label">Order</span>
        <span>{document.orderNo}</span>
      </div>
      <div className="receipt-row">
        <span className="receipt-row-label">Issued</span>
        <span>{issue.issuedAt.toISOString()}</span>
      </div>

      <hr className="receipt-rule" />

      <ul data-testid="receipt-lines">
        {document.lines.map((line, index) => (
          <li key={`${line.name ?? "line"}-${index}`}>
            <div className="receipt-row">
              <span className="receipt-row-label">
                {line.quantity} x {line.name}
              </span>
              {/* The string. Not the paisa, not a computation of the paisa. */}
              <span className="receipt-amount">{line.lineTotal.formatted}</span>
            </div>
            {line.modifiers.map((modifier) => (
              <div className="receipt-modifier" key={modifier}>
                + {modifier}
              </div>
            ))}
            {line.note ? <div className="receipt-note">{line.note}</div> : null}
          </li>
        ))}
      </ul>

      {totals ? (
        <>
          <hr className="receipt-rule" />
          <div className="receipt-row">
            <span className="receipt-row-label">Subtotal</span>
            <span className="receipt-amount">{totals.subtotal.formatted}</span>
          </div>
          <div className="receipt-row">
            <span className="receipt-row-label">Discount</span>
            <span className="receipt-amount">{totals.discount.formatted}</span>
          </div>
          {/*
            F20 — the line that used to print `Service charge Rs 0.00` on EVERY guest's bill.

            The rule is "label OR money", and each half earns its place:

              - a non-null label means the branch HAS a service charge on this check, so the row
                prints even at Rs 0.00 — a fully-comped 5% check genuinely owes nothing and the
                guest is still entitled to the line that says so;
              - a non-zero amount prints regardless, so money can never silently vanish off a
                bill. A document written before F20 added the snapshot carries an amount and no
                caption, and "Service charge" is then the honest default.

            What is gone is the third case, which was every bill this product ever produced: no
            label AND no money, printing `Service charge Rs 0.00`.

            The percentage is printed beside the label for the same reason the tax rows print
            theirs: a guest reading "Service charge Rs 49.90" asks "of what?", and the paper is
            the only thing still in their hand when they do.
          */}
          {totals.serviceChargeLabel || totals.serviceCharge.paisa !== 0 ? (
            <div className="receipt-row" data-testid="receipt-service-charge-row">
              <span className="receipt-row-label">
                {totals.serviceChargeLabel ?? "Service charge"}
                {totals.serviceChargeRatePercent
                  ? ` (${totals.serviceChargeRatePercent}%)`
                  : ""}
              </span>
              <span className="receipt-amount">{totals.serviceCharge.formatted}</span>
            </div>
          ) : null}

          {/*
            The phrase and the percentage. NOT `tax.rateCode` — F6.

            A rate code is a LEDGER classification: it tells an accountant which bucket a line
            reconciles into and means nothing to the person holding the paper. This row used to
            append it, and the live bill read `SR-STD-17 (17.00%) [SR-STD-17]` — the internal code
            twice on one line, wrapping onto a second line of an 80 mm roll.

            The document still carries the code, deliberately: it is the identity of the bucket and
            a stored print job is what a support engineer reads six weeks later. It is simply not a
            word this document says out loud, here or in the print agent's ESC/POS renderer, which
            is the path that produces the paper the guest actually walks out with.

            The key is composite because a bucket is (code, rate) server-side: one code can carry
            two rates across a menu edit, and `rateCode` alone would collide.
          */}
          {document.taxBreakdown.map((tax, index) => (
            <div
              className="receipt-row"
              key={`${tax.rateCode ?? "tax"}-${tax.ratePercent ?? ""}-${index}`}
            >
              <span className="receipt-row-label">
                {/*
                  A label the server left null still has to say what the money IS — a bare amount
                  against an empty phrase is a number on a bill with nothing naming it.
                */}
                {tax.label ?? "Tax"}
                {tax.ratePercent ? ` (${tax.ratePercent}%)` : ""}
              </span>
              <span className="receipt-amount">{tax.amount.formatted}</span>
            </div>
          ))}

          {/*
            D-4 — the summary row, and ONLY when it is not a second printing of the line above it.

            A real bill on 2026-08-12 read:

              Sales Tax (16.00%)          Rs   230.67
              Tax                         Rs   230.67

            Two lines, one amount, one immediately under the other, on a customer-facing document.
            The total was right, so no money was wrong — but a guest counting their own bill finds
            Rs 230.67 charged twice and says so, and the till has nothing to answer with.

            The rule: the breakdown already states the tax. When it states it on ONE line, that
            line IS the total and repeating it is the defect. When it states it on several, a
            summing row is doing real work — a guest should not have to add up three rates
            themselves. When there is no breakdown at all (a zero-rated check, or a document whose
            lines carry no attributable tax), the row is the only place the tax is named and must
            stay: silence there would read as "no tax was charged", which is a different claim.
          */}
          {document.taxBreakdown.length !== 1 && (
            <div className="receipt-row">
              <span className="receipt-row-label">Tax</span>
              <span className="receipt-amount">{totals.tax.formatted}</span>
            </div>
          )}

          <hr className="receipt-rule" />
          <div className="receipt-row receipt-grand-total">
            <span className="receipt-row-label">TOTAL</span>
            <span className="receipt-amount">{totals.grandTotal.formatted}</span>
          </div>
        </>
      ) : null}

      {document.tenders.length > 0 ? (
        <>
          <hr className="receipt-rule" />
          {document.tenders.map((tender, index) => (
            <div key={`${tender.method ?? "tender"}-${index}`}>
              <div className="receipt-row">
                <span className="receipt-row-label">{tender.method}</span>
                <span className="receipt-amount">{tender.amountApplied.formatted}</span>
              </div>
              {/*
                F20 — the tip, on its own line under the tender that carried it, and only when
                there is one. It is deliberately NOT folded into the amount above: that figure is
                what settled the bill and it has to keep summing to the grand total, which is the
                identity this whole document is checked against. A guest looking at a Rs 998 bill
                and a Rs 1,048 card slip is owed the sentence that explains the difference.
              */}
              {tender.tip.paisa > 0 ? (
                <div className="receipt-row" data-testid="receipt-tip-row">
                  <span className="receipt-row-label">Tip</span>
                  <span className="receipt-amount">{tender.tip.formatted}</span>
                </div>
              ) : null}
              {/*
                Tendered and change are printed only when there IS change — a card tender has
                neither, and printing "Change Rs 0.00" under a card payment invites the question
                "where is my change?" at the counter.
              */}
              {tender.change.paisa > 0 ? (
                <>
                  <div className="receipt-row">
                    <span className="receipt-row-label">Tendered</span>
                    <span className="receipt-amount">{tender.amountTendered.formatted}</span>
                  </div>
                  <div className="receipt-row">
                    <span className="receipt-row-label">Change</span>
                    <span className="receipt-amount">{tender.change.formatted}</span>
                  </div>
                </>
              ) : null}
              {tender.referenceNo ? (
                <div className="receipt-row">
                  <span className="receipt-row-label">Ref</span>
                  <span>{tender.referenceNo}</span>
                </div>
              ) : null}
            </div>
          ))}
        </>
      ) : null}

      <FiscalRegion fiscal={document.fiscal} />

      {footer && footer.lines.length > 0 ? (
        <>
          <hr className="receipt-rule" />
          <div className="receipt-center">
            {footer.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
