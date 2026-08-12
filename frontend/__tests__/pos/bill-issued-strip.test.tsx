import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BillIssuedStrip } from "@/components/pos/bill-issued-strip";
import type { PrintJobIssue } from "@/lib/models/order-bill.model";

/**
 * §3-3 — what the cashier can READ off the charge page about the guest's bill.
 *
 * <p>Assertions are on rendered TEXT and on the four states a data-backed surface must have
 * (loading, empty, error, success), not on props. A strip that renders "a bill exists" without
 * saying WHEN could not have caught the defect this exists for: a check paid at 02:59 whose
 * receipt was stamped 03:15, at the close.
 */

function issue(overrides: Partial<PrintJobIssue> = {}): PrintJobIssue {
  return {
    printJobId: "aa000001-0000-4000-8000-000000000001",
    documentType: "CUSTOMER_RECEIPT",
    targetPrinterId: "audit-receipt",
    issueSeq: 1,
    status: "QUEUED",
    issuedAt: "2026-08-12T04:41:27Z",
    originalIssuedAt: null,
    ...overrides,
  };
}

const noop = () => {};

describe("BillIssuedStrip", () => {
  it("names the moment the bill was issued, and the printer it went to", () => {
    render(
      <BillIssuedStrip isLoading={false} isError={false} onRetry={noop} bill={issue()} reprintCount={0} />,
    );

    const strip = screen.getByTestId("bill-issued-strip");
    expect(strip).toHaveAttribute("data-bill-issued", "true");
    expect(strip).toHaveTextContent(/Bill issued/i);
    expect(strip).toHaveAttribute("data-bill-issued-at", "2026-08-12T04:41:27Z");
    expect(strip).toHaveTextContent(/audit-receipt/);
  });

  it("never claims paper came out — only that the job was sent", () => {
    render(
      <BillIssuedStrip isLoading={false} isError={false} onRetry={noop} bill={issue()} reprintCount={0} />,
    );

    // A QUEUED job is one the branch agent has not collected yet. Saying "printed" here would be
    // the same lie the receipt page used to tell about nine cold agents.
    expect(screen.getByTestId("bill-issued-strip").textContent).not.toMatch(/printed\b/i);
  });

  it("says plainly when no bill has been produced", () => {
    render(
      <BillIssuedStrip isLoading={false} isError={false} onRetry={noop} bill={null} reprintCount={0} />,
    );

    const strip = screen.getByTestId("bill-issued-strip");
    expect(strip).toHaveAttribute("data-bill-issued", "false");
    expect(strip).toHaveTextContent(/No bill has been produced/i);
  });

  it("counts the copies issued after the original without moving the original's time", () => {
    render(
      <BillIssuedStrip isLoading={false} isError={false} onRetry={noop} bill={issue()} reprintCount={2} />,
    );

    const strip = screen.getByTestId("bill-issued-strip");
    expect(strip).toHaveAttribute("data-bill-issued-at", "2026-08-12T04:41:27Z");
    expect(strip).toHaveTextContent(/2 copies reprinted since/i);
  });

  it("explains the browser path on a branch with no receipt printer", () => {
    render(
      <BillIssuedStrip
        isLoading={false}
        isError={false}
        onRetry={noop}
        bill={issue({ targetPrinterId: "unassigned" })}
        reprintCount={0}
      />,
    );

    expect(screen.getByTestId("bill-issued-strip")).toHaveTextContent(
      /no receipt printer configured/i,
    );
  });

  it("shows a retry, not a silent blank, when the read failed", async () => {
    const retry = vi.fn();
    render(
      <BillIssuedStrip isLoading={false} isError onRetry={retry} bill={null} reprintCount={0} />,
    );
    const user = userEvent.setup();

    const alert = screen.getByTestId("bill-issued-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(/Couldn’t check whether a bill was issued/i);
    // An error must never be mistaken for "there is no bill" — the two say different things.
    expect(screen.queryByTestId("bill-issued-strip")).toBeNull();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("says it is still looking rather than asserting an answer it does not have", () => {
    render(<BillIssuedStrip isLoading isError={false} onRetry={noop} bill={null} reprintCount={0} />);

    expect(screen.getByTestId("bill-issued-loading")).toHaveTextContent(/Checking for/i);
    expect(screen.queryByTestId("bill-issued-strip")).toBeNull();
  });
});
