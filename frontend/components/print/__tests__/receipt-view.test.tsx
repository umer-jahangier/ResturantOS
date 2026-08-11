import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { adaptPrintDocument } from "@/lib/adapters/print.adapter";

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

const ISSUED = {
  printJobId: "aaaaaaaa-0000-4000-8000-000000000001",
  targetPrinterId: "receipt-1",
  document: adaptPrintDocument(
    JSON.parse(readFileSync(locateFixture(), "utf8")) as Parameters<typeof adaptPrintDocument>[0],
  ),
};

/**
 * The printable-bill screen (26-05 task 3).
 *
 * <p>The assertion this file exists for is the last one: <b>a failed issue must not render an
 * empty bill.</b> An empty bill is worse than an error message, because the cashier will hand it
 * over — the customer leaves with paper showing no items and no total, and nobody finds out until
 * they come back.
 */
describe("ReceiptView", () => {
  beforeEach(() => {
    vi.mocked(PrintRepository.issueReceipt).mockReset();
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
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(ISSUED);

    renderView();

    await waitFor(() => expect(screen.getByTestId("receipt-root")).toBeInTheDocument());
    const root = screen.getByTestId("receipt-root");
    expect(root).toHaveTextContent("Rs 2,843.47");
    expect(root).toHaveTextContent("Chicken Karahi (Full)");
    expect(screen.queryByTestId("query-error")).toBeNull();
  });

  it("issues exactly ONCE per mount and opens the print dialog exactly once", async () => {
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(ISSUED);

    renderView();
    await waitFor(() => expect(screen.getByTestId("receipt-root")).toBeInTheDocument());

    // Issuing WRITES a print_jobs row and allocates a sequence. A second call per mount would put
    // a phantom reprint in a customer's history.
    expect(PrintRepository.issueReceipt).toHaveBeenCalledTimes(1);
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("sends a stable idempotency key, so a retry cannot inflate the reprint count", async () => {
    vi.mocked(PrintRepository.issueReceipt).mockResolvedValue(ISSUED);

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
});
