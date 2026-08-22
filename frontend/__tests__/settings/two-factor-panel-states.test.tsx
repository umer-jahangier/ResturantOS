import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The failure state of the two-factor panel.
 *
 * <h3>Why this test exists</h3>
 *
 * The panel shipped handling its query's PENDING state and not its FAILURE one. `enabled` came
 * from `status.data?.enabled ?? false`, and the "set up two-factor authentication" branch was
 * gated on `!status.isPending`. On a failed request `isPending` is false and `data` is undefined,
 * so an unreachable auth-service rendered a confident **"two-factor is off — set it up"** to a
 * user whose second factor was ON.
 *
 * That is the worst direction to be wrong in on a security control. It reports a protection the
 * user may still have as absent, and invites re-enrolment of a live factor. It is the same shape
 * as the phase-14b defect that read an error as an empty result and told an owner they had no
 * vendors while the service was down.
 *
 * A settings screen may say "I could not find out". It may never turn "I could not find out" into
 * "it is off".
 */
const status = {
  data: undefined as unknown,
  isPending: false,
  isSuccess: false,
  isError: false,
  isFetching: false,
  error: undefined as unknown,
  refetch: vi.fn(),
};

vi.mock("@/lib/hooks/auth/use-totp-enrollment", () => ({
  useTwoFactorStatus: () => status,
  useTotpSetup: () => ({ mutate: vi.fn(), isPending: false }),
  useTotpVerify: () => ({ mutate: vi.fn(), isPending: false }),
  useRegenerateRecoveryCodes: () => ({ mutate: vi.fn(), isPending: false }),
  useTotpDisable: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { TwoFactorPanel } = await import("@/components/settings/two-factor-panel");

function setStatus(next: Partial<typeof status>) {
  Object.assign(
    status,
    {
      data: undefined,
      isPending: false,
      isSuccess: false,
      isError: false,
      isFetching: false,
      error: undefined,
    },
    next,
  );
}

describe("TwoFactorPanel — the state it must not guess", () => {
  beforeEach(() => setStatus({}));

  it("does NOT claim two-factor is off when the status request failed", () => {
    setStatus({ isError: true, error: new Error("network") });
    render(<TwoFactorPanel />);

    // The exact regression: an unreachable service must not render an invitation to enrol.
    expect(screen.queryByTestId("two-factor-start")).not.toBeInTheDocument();
    expect(screen.queryByText(/set up two-factor authentication/i)).not.toBeInTheDocument();
  });

  it("offers no management actions either — both directions are unknown, not false", () => {
    setStatus({ isError: true, error: new Error("network") });
    render(<TwoFactorPanel />);

    expect(screen.queryByTestId("two-factor-regenerate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("two-factor-disable")).not.toBeInTheDocument();
    expect(screen.queryByTestId("recovery-codes-remaining")).not.toBeInTheDocument();
  });

  it("says plainly that it could not read the setting", () => {
    setStatus({ isError: true, error: new Error("network") });
    render(<TwoFactorPanel />);
    expect(screen.getByText(/two-factor status|couldn't load|could not/i)).toBeInTheDocument();
  });

  it("renders nothing decisive while the request is still in flight", () => {
    setStatus({ isPending: true });
    render(<TwoFactorPanel />);
    expect(screen.queryByTestId("two-factor-start")).not.toBeInTheDocument();
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it("DOES offer enrolment once the status is known to be off", () => {
    setStatus({ isSuccess: true, data: { enabled: false, recoveryCodesRemaining: 0 } });
    render(<TwoFactorPanel />);
    expect(screen.getByTestId("two-factor-start")).toBeInTheDocument();
  });

  it("DOES offer management once the status is known to be on", () => {
    setStatus({ isSuccess: true, data: { enabled: true, recoveryCodesRemaining: 8 } });
    render(<TwoFactorPanel />);
    expect(screen.getByTestId("recovery-codes-remaining")).toBeInTheDocument();
    expect(screen.queryByTestId("two-factor-start")).not.toBeInTheDocument();
  });
});
