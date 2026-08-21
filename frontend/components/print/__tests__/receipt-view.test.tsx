import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { adaptPrintDocument } from "@/lib/adapters/print.adapter";
import type { PrintAgentPresence, PrintJobStatus } from "@/lib/models/print-agent.model";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/hooks/auth/use-current-user", () => ({
  useCurrentUser: () => ({
    isAuthenticated: true,
    branchId: "22222222-2222-4222-8222-222222222222",
  }),
}));
vi.mock("@/lib/repositories/print.repository", () => ({
  PrintRepository: { issueReceipt: vi.fn(), getPrintJob: vi.fn() },
}));

const { PrintRepository } = await import("@/lib/repositories/print.repository");
const { ReceiptView } = await import("@/components/print/receipt-view");

const FIXTURE_RELATIVE = join("contracts", "print", "golden-receipt-document.json");

function locateFixture(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, FIXTURE_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not find ${FIXTURE_RELATIVE} from ${process.cwd()}`);
}

const DOCUMENT = adaptPrintDocument(
  JSON.parse(readFileSync(locateFixture(), "utf8")) as Parameters<typeof adaptPrintDocument>[0],
);

/** An agent that answered a second ago — inside `AGENT_CONNECTED_WINDOW_MS`. */
const LIVE_AGENT: PrintAgentPresence = {
  enrolled: 1,
  label: "Back office PC",
  lastSeenAt: new Date(Date.now() - 1_000).toISOString(),
};

/** The state the whole product was measured in on 2026-08-12: enrolled, cold for hours. */
const COLD_AGENT: PrintAgentPresence = {
  enrolled: 9,
  label: "Counter till",
  lastSeenAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
};

const NO_AGENT_AT_ALL: PrintAgentPresence = { enrolled: 0, label: null, lastSeenAt: null };

function issued(
  overrides: Partial<{
    targetPrinterId: string;
    status: PrintJobStatus;
    agent: PrintAgentPresence;
  }> = {},
) {
  return {
    printJobId: "aaaaaaaa-0000-4000-8000-000000000001",
    targetPrinterId: "receipt-1",
    document: DOCUMENT,
    status: "QUEUED" as PrintJobStatus,
    agent: LIVE_AGENT,
    ...overrides,
  };
}

/**
 * The printable-bill screen (26-05 task 3).
 *
 * <p>Two assertions this file exists for.
 *
 * <p><b>A failed issue must not render an empty bill.</b> An empty bill is worse than an error
 * message, because the cashier will hand it over — the customer leaves with paper showing no items
 * and no total, and nobody finds out until they come back.
 *
 * <p><b>The screen must never claim paper it has not observed.</b> This screen shipped rendering
 * "Sent to the receipt printer … the branch print agent will put it on paper" for EVERY routed
 * bill, with no reference to whether any agent existed or had ever polled. Measured live with nine
 * enrolled agents, all cold. The `NO_AGENT` cases below are that defect pinned: they fail against
 * the old component, which had no state to fail in.
 */
describe("ReceiptView", () => {
  beforeEach(() => {
    vi.mocked(PrintRepository.issueReceipt).mockReset();
    vi.mocked(PrintRepository.getPrintJob).mockReset();
    // jsdom does not implement window.print and throws if it is called.
    Object.defineProperty(window, "print", { value: vi.fn(), writable: true, configurable: true });
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn();
  });

  function renderView() {
    return render(<ReceiptView orderId="order-1" />, { wrapper: createQueryWrapper() });
  }

  it("renders the issued bill for a settled order", async () => {
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(issued());
    vi.mocked(PrintRepository.getPrintJob).mockResolvedValue(issued());

    renderView();

    await waitFor(() => expect(screen.getByTestId("receipt-root")).toBeInTheDocument());
    const root = screen.getByTestId("receipt-root");
    expect(root).toHaveTextContent("Rs 2,843.47");
    expect(root).toHaveTextContent("Chicken Karahi (Full)");
    expect(screen.queryByTestId("query-error")).toBeNull();
  });

  /**
   * S1-06. This pair replaces a single test that asserted the dialog ALWAYS opened — while the
   * fixture it used names a real printer (`receipt-1`). That is the register's "window.print()
   * count 2, agent calls 0" pinned as correct: a branch that had bought, wired and configured a
   * thermal printer still got a Ctrl-P dialog on every bill, and a green test said so.
   */
  it("does NOT open the browser dialog when the bill is routed to a real printer", async () => {
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(issued());
    vi.mocked(PrintRepository.getPrintJob).mockResolvedValue(issued());

    renderView();
    await waitFor(() => expect(screen.getByTestId("receipt-root")).toBeInTheDocument());

    // Issuing WRITES a print_jobs row and allocates a sequence. A second call per mount would put
    // a phantom reprint in a customer's history.
    expect(PrintRepository.issueReceipt).toHaveBeenCalledTimes(1);
    // The job is queued for the agent; the paper comes off the thermal printer. A dialog here is
    // the product asking the cashier to do by hand the thing it was just configured to do.
    expect(window.print).not.toHaveBeenCalled();
    expect(screen.getByTestId("delivery-notice")).toHaveAttribute(
      "data-target-printer",
      "receipt-1",
    );
  });

  it("DOES open the browser dialog when the branch has no printer configured", async () => {
    // `"unassigned"` is pos-service's sentinel for a branch with no receipt printer — a supported
    // branch, not an error (D-26-01). There the browser bill is the honest and only path.
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(
      issued({ targetPrinterId: "unassigned", status: "ISSUED" }),
    );

    renderView();
    await waitFor(() => expect(screen.getByTestId("receipt-root")).toBeInTheDocument());

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("delivery-notice")).toHaveAttribute(
      "data-delivery-state",
      "NO_PRINTER",
    );
    // There is no agent to wait for, so the screen must not be polling a row nothing will move.
    expect(PrintRepository.getPrintJob).not.toHaveBeenCalled();
  });

  it("sends a stable idempotency key, so a retry cannot inflate the reprint count", async () => {
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(issued());
    vi.mocked(PrintRepository.getPrintJob).mockResolvedValue(issued());

    renderView();
    await waitFor(() => expect(screen.getByTestId("receipt-root")).toBeInTheDocument());

    const call = vi.mocked(PrintRepository.issueReceipt).mock.calls[0];
    expect(call?.[0]).toBe("order-1");
    expect(typeof call?.[2]).toBe("string");
    expect(call?.[2]).toBeTruthy();
  });

  it("renders an ERROR when the issue fails — never an empty bill", async () => {
    vi.mocked(PrintRepository.issueReceipt).mockRejectedValue(new Error("gateway 503"));

    renderView();

    await waitFor(() => expect(screen.getByTestId("query-error")).toBeInTheDocument());

    expect(screen.queryByTestId("receipt-root")).toBeNull();
    expect(screen.getByTestId("query-error")).toHaveAttribute("role", "alert");
    // And the print dialog never opened over a bill that does not exist.
    expect(window.print).not.toHaveBeenCalled();
  });

  // ── F8: the screen may not claim paper it has not observed ──────────────────────────────────

  /**
   * The exact shape found in the walkthrough: agents enrolled, none of them answering, and the
   * screen promising paper anyway. Against the old component this test fails on every assertion —
   * it rendered "Sent to the receipt printer" and had no `NO_AGENT` state at all.
   */
  it("says the bill has NOT been printed, and NAMES the offline agent, when nothing is polling", async () => {
    const cold = issued({ status: "QUEUED", agent: COLD_AGENT });
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(cold);
    vi.mocked(PrintRepository.getPrintJob).mockResolvedValue(cold);

    renderView();
    await waitFor(() => expect(screen.getByTestId("delivery-notice")).toBeInTheDocument());

    const notice = screen.getByTestId("delivery-notice");
    expect(notice).toHaveAttribute("data-delivery-state", "NO_AGENT");
    // The sentence a cashier reads, not a prop.
    expect(notice).toHaveTextContent("This bill has NOT been printed");
    // Named, so the manager knows which machine to go and look at.
    expect(notice).toHaveTextContent("Counter till");
    expect(notice).toHaveTextContent(/last answered 4 hours ago/);
    // It is a real failure and must be announced as one.
    expect(notice).toHaveAttribute("role", "alert");
    // The old promise must be gone, not merely joined by a warning.
    expect(notice).not.toHaveTextContent("will put it on paper");
    expect(notice).not.toHaveTextContent("Sent to the receipt printer");
  });

  it("says so plainly when the branch has a printer but no agent is enrolled at all", async () => {
    const orphan = issued({ status: "QUEUED", agent: NO_AGENT_AT_ALL });
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(orphan);
    vi.mocked(PrintRepository.getPrintJob).mockResolvedValue(orphan);

    renderView();
    await waitFor(() => expect(screen.getByTestId("delivery-notice")).toBeInTheDocument());

    const notice = screen.getByTestId("delivery-notice");
    expect(notice).toHaveAttribute("data-delivery-state", "NO_AGENT");
    expect(notice).toHaveTextContent("No print agent is enrolled on this branch");
    expect(notice).toHaveAttribute("role", "alert");
  });

  /**
   * The only state in which the product may say the word "printed" — and it comes from the agent's
   * own acknowledgement arriving on a re-read, not from the issue response.
   */
  it("claims paper ONLY after the agent acknowledges, and reads that from the live row", async () => {
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(
      issued({ status: "QUEUED", agent: LIVE_AGENT }),
    );
    vi.mocked(PrintRepository.getPrintJob).mockResolvedValue(
      issued({ status: "PRINTED", agent: LIVE_AGENT }),
    );

    renderView();

    await waitFor(() =>
      expect(screen.getByTestId("delivery-notice")).toHaveAttribute(
        "data-delivery-state",
        "ON_PAPER",
      ),
    );
    const notice = screen.getByTestId("delivery-notice");
    expect(notice).toHaveTextContent("Printed on receipt-1");
    expect(notice).toHaveTextContent("Back office PC");
    // A confirmed print is not an alert.
    expect(notice).not.toHaveAttribute("role", "alert");
    expect(window.print).not.toHaveBeenCalled();
  });

  it("reports the agent's refusal rather than a silent nothing when the job is dead-lettered", async () => {
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(
      issued({ status: "QUEUED", agent: LIVE_AGENT }),
    );
    vi.mocked(PrintRepository.getPrintJob).mockResolvedValue(
      issued({ status: "DEAD_LETTERED", agent: LIVE_AGENT }),
    );

    renderView();

    await waitFor(() =>
      expect(screen.getByTestId("delivery-notice")).toHaveAttribute(
        "data-delivery-state",
        "REFUSED",
      ),
    );
    expect(screen.getByTestId("delivery-notice")).toHaveTextContent(
      "The print agent could not print this bill",
    );
    expect(screen.getByTestId("delivery-notice")).toHaveAttribute("role", "alert");
  });

  it("keeps a delivery-read failure visible instead of leaving 'printing…' on screen for ever", async () => {
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(
      issued({ status: "QUEUED", agent: LIVE_AGENT }),
    );
    vi.mocked(PrintRepository.getPrintJob).mockRejectedValue(new Error("gateway 503"));

    renderView();

    await waitFor(() => expect(screen.getByTestId("delivery-unconfirmed")).toBeInTheDocument());
    expect(screen.getByTestId("delivery-unconfirmed")).toHaveTextContent(
      "can no longer confirm what happened to the paper",
    );
  });

  it("labels the print button for the job it is actually doing", async () => {
    const cold = issued({ status: "QUEUED", agent: COLD_AGENT });
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(cold);
    vi.mocked(PrintRepository.getPrintJob).mockResolvedValue(cold);

    renderView();
    await waitFor(() => expect(screen.getByTestId("delivery-notice")).toBeInTheDocument());

    // Nothing else is going to produce paper, so this is not "a browser copy" — it is the bill.
    expect(screen.getByTestId("print-again-button")).toHaveTextContent("Print a paper copy");
  });
});
