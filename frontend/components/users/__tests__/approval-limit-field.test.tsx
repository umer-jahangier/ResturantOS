import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  AMOUNT_GATED_PERMISSIONS,
  ApprovalLimitField,
  type ApprovalLimitValue,
  approvalLimitPayloadValue,
  isApprovalLimitDecided,
  paisaToRupeeInput,
  parseRupeesToPaisa,
  roleNeedsApprovalLimit,
} from "@/components/users/approval-limit-field";

/** A controlled harness, so the assertions are about the component and not about a stub. */
function Harness({ onValue }: { onValue?: (v: ApprovalLimitValue) => void }) {
  const [value, setValue] = React.useState<ApprovalLimitValue>({ kind: "unset" });
  return (
    <ApprovalLimitField
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      roleLabel="MANAGER"
    />
  );
}

describe("approval limit — money stays integer paisa", () => {
  it("parses rupees to paisa by string, never by multiplication", () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754. This is the case a `Math.round(x*100)`
    // implementation gets right by luck and the general case it gets wrong.
    expect(parseRupeesToPaisa("19.99")).toEqual({ paisa: 1999 });
    expect(parseRupeesToPaisa("0.1")).toEqual({ paisa: 10 });
    expect(parseRupeesToPaisa("0")).toEqual({ paisa: 0 });
    expect(parseRupeesToPaisa("300000")).toEqual({ paisa: 30000000 });
    // The MANAGER limit the seed writes, round-tripped.
    expect(parseRupeesToPaisa(paisaToRupeeInput(30000000))).toEqual({ paisa: 30000000 });
  });

  it("refuses anything that is not a non-negative amount with at most two decimals", () => {
    for (const bad of ["-1", "1.234", "abc", "1e3", "", " ", "1,000"]) {
      expect(parseRupeesToPaisa(bad)).toHaveProperty("error");
    }
  });

  it("never holds a fractional number in the produced value", async () => {
    const seen: ApprovalLimitValue[] = [];
    render(<Harness onValue={(v) => seen.push(v)} />);

    await userEvent.type(screen.getByLabelText("Approval limit"), "12500.75");

    for (const v of seen) {
      if (v.kind === "limit") {
        expect(Number.isInteger(v.paisa)).toBe(true);
      }
    }
    const last = seen.at(-1);
    expect(last).toEqual({ kind: "limit", paisa: 1250075 });
  });
});

describe("approval limit — no authority is not the same as zero", () => {
  it("the explicit no-authority choice submits an absent limit", async () => {
    const seen: ApprovalLimitValue[] = [];
    render(<Harness onValue={(v) => seen.push(v)} />);

    await userEvent.click(screen.getByTestId("approval-limit-none"));

    expect(seen.at(-1)).toEqual({ kind: "none" });
    expect(approvalLimitPayloadValue({ kind: "none" })).toBeNull();
  });

  it("a limit of zero submits zero, which is a different payload from absent", () => {
    expect(approvalLimitPayloadValue({ kind: "limit", paisa: 0 })).toBe(0);
    expect(approvalLimitPayloadValue({ kind: "none" })).toBeNull();
  });

  it("states the identity rather than hiding it", () => {
    render(<Harness />);
    const help = screen.getByText(/limit of Rs 0.00 and no/i);
    expect(help.textContent).toMatch(/both refuse every approval/i);
  });
});

describe("approval limit — an undecided field blocks submission", () => {
  it("starts undecided", () => {
    expect(isApprovalLimitDecided({ kind: "unset" })).toBe(false);
    expect(isApprovalLimitDecided({ kind: "none" })).toBe(true);
    expect(isApprovalLimitDecided({ kind: "limit", paisa: 0 })).toBe(true);
  });

  it("an unparseable amount leaves it undecided and says why", async () => {
    const seen: ApprovalLimitValue[] = [];
    render(<Harness onValue={(v) => seen.push(v)} />);

    await userEvent.type(screen.getByLabelText("Approval limit"), "1.234");

    expect(screen.getByTestId("approval-limit-error")).toBeTruthy();
    expect(isApprovalLimitDecided(seen.at(-1)!)).toBe(false);
  });
});

describe("approval limit — which roles need one comes from permissions, never role codes", () => {
  it("names its three policy sources and holds exactly them", () => {
    expect([...AMOUNT_GATED_PERMISSIONS].sort()).toEqual(
      ["finance.expense.approve", "pos.order.refund", "vendor.po.approve"].sort(),
    );
  });

  it("a custom role holding an amount-gated permission needs a limit", () => {
    // Not MANAGER, not any built-in code — the exact case a hardcoded role list would miss.
    expect(roleNeedsApprovalLimit(["vendor.view", "vendor.po.approve"])).toBe(true);
    expect(roleNeedsApprovalLimit(["pos.order.refund"])).toBe(true);
    expect(roleNeedsApprovalLimit(["finance.expense.approve"])).toBe(true);
  });

  it("a role holding none of them does not", () => {
    expect(roleNeedsApprovalLimit(["vendor.view", "vendor.po.create", "vendor.po.close"])).toBe(
      false,
    );
    expect(roleNeedsApprovalLimit([])).toBe(false);
    expect(roleNeedsApprovalLimit(undefined)).toBe(false);
  });
});

describe("approval limit — the preview reads back through one presentation boundary", () => {
  it("shows the entered limit as money", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText("Approval limit"), "300000");
    expect(screen.getByTestId("approval-limit-preview").textContent).toContain("300,000.00");
  });

  it("renders stored paisa back into the input without a float", () => {
    expect(paisaToRupeeInput(30000000)).toBe("300000.00");
    expect(paisaToRupeeInput(1999)).toBe("19.99");
    expect(paisaToRupeeInput(0)).toBe("0.00");
    expect(paisaToRupeeInput(5)).toBe("0.05");
  });
});

// Guard against a stray console error turning into a silently-passing test.
vi.spyOn(console, "error").mockImplementation((...args) => {
  throw new Error(`console.error during test: ${args.join(" ")}`);
});
