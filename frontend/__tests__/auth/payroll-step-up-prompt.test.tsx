import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import PayrollPage from "@/app/(tenant)/app/hr/payroll/page";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/hr/payroll",
}));

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
  Toaster: () => null,
}));

const RUN_ID = "33333333-3333-3333-8333-333333333333";
const APPROVE_URL = `*/api/v1/hr/payroll-runs/${RUN_ID}/approve`;

function hrError(code: string, message: string, status: number) {
  return HttpResponse.json({ error: { code, message, details: [], traceId: "t" } }, { status });
}

function renderPayrollPage() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <PayrollPage />
    </Wrapper>,
  );
}

beforeEach(() => {
  pushMock.mockClear();
  toastErrorMock.mockClear();
  seedSession({ permissions: ["hr.payroll.view", "hr.payroll.run", "hr.payroll.approve"] });

  server.use(
    http.get("*/api/v1/hr/payroll-runs", () =>
      HttpResponse.json({
        data: [
          {
            id: RUN_ID,
            branchId: "branch-1",
            periodMonth: 7,
            periodYear: 2026,
            status: "CALCULATED",
            totalGrossPaisa: 100000,
            totalNetPaisa: 90000,
          },
        ],
      }),
    ),
  );
});
afterEach(() => clearSession());

describe("payroll approval when the step-up claim has aged out", () => {
  // An approver an hour into their session hits this on a run that is perfectly fine. The old
  // handler toasted "Action failed", which points at payroll — the one place nothing is wrong.
  it("prompts for re-authentication instead of toasting a generic failure", async () => {
    server.use(
      http.post(APPROVE_URL, () =>
        hrError("TOTP_REQUIRED", "TOTP step-up verification is required to approve", 403),
      ),
    );
    const user = userEvent.setup();
    renderPayrollPage();

    await user.click(await screen.findByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(screen.getByText(/verification expired/i)).toBeInTheDocument());
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("routes to login with a code prompt and a way back", async () => {
    server.use(
      http.post(APPROVE_URL, () =>
        hrError("TOTP_REQUIRED", "TOTP step-up verification is required to approve", 403),
      ),
    );
    const user = userEvent.setup();
    renderPayrollPage();

    await user.click(await screen.findByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(screen.getByText(/verification expired/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /sign in again/i }));

    expect(pushMock).toHaveBeenCalledWith(
      "/login?reason=step_up_required&next=%2Fapp%2Fhr%2Fpayroll",
    );
  });

  it("still reports a real approval failure as a failure", async () => {
    server.use(
      http.post(APPROVE_URL, () => hrError("STATE_INVALID", "Run is not CALCULATED", 409)),
    );
    const user = userEvent.setup();
    renderPayrollPage();

    await user.click(await screen.findByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Action failed"));
    expect(screen.queryByText(/verification expired/i)).not.toBeInTheDocument();
  });

  // The button used to be labelled "Approve (TOTP)" and open a window.prompt for a code that was
  // then discarded. Nothing the approver types can satisfy a gate read from a signed claim.
  it("does not prompt for a code it cannot use", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    server.use(
      http.post(APPROVE_URL, () =>
        HttpResponse.json({
          data: {
            id: RUN_ID,
            periodMonth: 7,
            periodYear: 2026,
            status: "APPROVED",
            totalGrossPaisa: 100000,
            totalNetPaisa: 90000,
          },
        }),
      ),
    );
    const user = userEvent.setup();
    renderPayrollPage();

    await user.click(await screen.findByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Approved"));
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });
});
