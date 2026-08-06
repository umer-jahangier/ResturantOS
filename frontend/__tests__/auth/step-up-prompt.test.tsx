import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { PeriodCloseModal } from "@/components/finance/PeriodCloseModal";
import type { AccountingPeriod } from "@/lib/models/finance.model";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/finance/periods",
}));

const PERIOD_ID = "22222222-2222-2222-8222-222222222222";
const CLOSE_URL = `*/api/v1/finance/periods/${PERIOD_ID}/close`;

const period: AccountingPeriod = {
  id: PERIOD_ID,
  fiscalYear: 2026,
  periodNo: 1,
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  status: "OPEN",
  lockedBy: null,
  lockedAt: null,
};

function financeError(code: string, message: string, status: number) {
  return HttpResponse.json({ code, message, timestamp: "2026-08-06T00:00:00Z" }, { status });
}

function renderModal() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <PeriodCloseModal period={period} onClose={vi.fn()} onSuccess={vi.fn()} />
    </Wrapper>,
  );
}

beforeEach(() => {
  pushMock.mockClear();
  seedSession();
});
afterEach(() => clearSession());

describe("a step-up-gated action after the claim has aged out", () => {
  // The state this exists for: signed in, permitted, nothing wrong — but the hour-long
  // `totp_verified` claim is gone and the server says TOTP_REQUIRED.
  it("explains that verification expired instead of reporting a failure", async () => {
    server.use(
      http.post(CLOSE_URL, () =>
        financeError("TOTP_REQUIRED", "TOTP step-up verification is required", 403),
      ),
    );
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /close period/i }));

    await waitFor(() => expect(screen.getByText(/verification expired/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
    // The generic mapping for this code ("A verification code is required for this action.")
    // says nothing about what to DO, which is the whole gap being closed here.
    expect(screen.queryByText(/a verification code is required/i)).not.toBeInTheDocument();
  });

  it("sends the user to re-authenticate and back to where they were", async () => {
    server.use(
      http.post(CLOSE_URL, () =>
        financeError("TOTP_REQUIRED", "TOTP step-up verification is required", 403),
      ),
    );
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /close period/i }));
    await waitFor(() => expect(screen.getByText(/verification expired/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /sign in again/i }));

    expect(pushMock).toHaveBeenCalledWith(
      "/login?reason=step_up_required&next=%2Fapp%2Ffinance%2Fperiods",
    );
  });

  it("leaves every other failure on the generic path", async () => {
    server.use(
      http.post(CLOSE_URL, () =>
        financeError("PERIOD_PRE_CHECK_FAILED", "Unposted entries remain", 422),
      ),
    );
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /close period/i }));

    await waitFor(() =>
      expect(screen.getByText(/period cannot be closed yet/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/verification expired/i)).not.toBeInTheDocument();
  });

  // The dialog used to collect a 6-digit code and drop it: `void totpCode`. Asking for a secret
  // that is discarded teaches the user the prompt is meaningless, and it is the wrong secret —
  // the gate reads a claim minted at login, which no code typed here can produce.
  it("does not ask for a code it cannot use", () => {
    renderModal();

    expect(screen.queryByLabelText(/totp/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
