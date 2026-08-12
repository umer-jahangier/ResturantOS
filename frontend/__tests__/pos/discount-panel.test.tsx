import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { ChargeSummary } from "@/components/pos/charge-summary";
import type { Order, OrderPayment } from "@/lib/models/pos.model";

/**
 * B3 — a discount can be given, on the screen where a bill is presented.
 *
 * <h2>What these assert, and what they deliberately do not</h2>
 *
 * Every assertion here is something a cashier can SEE or DO: a control that exists, a button
 * that is disabled, a sentence on the screen, a request that leaves. None of them reach into
 * props. The register's finding was measured exactly this way — it probed the charge page for
 * any control matching /discount|comp|off|promo/ and got `[]` — so the proof has to be made in
 * the same currency.
 *
 * <h2>Falsification, watched</h2>
 *
 * <ul>
 *   <li>Delete the {@code <DiscountPanel/>} line from charge-summary.tsx and
 *       {@link #theChargePageOffersADiscountControl} fails: no control by that name exists,
 *       which is the pre-B3 state exactly.</li>
 *   <li>Drop the {@code reasonError} branch from discount-panel.tsx and
 *       "refuses to submit until a reason is given" fails — the button is enabled with an empty
 *       reason box.</li>
 *   <li>Show the whole-check option to a cashier without the manager sentence and
 *       "tells a cashier who can do it instead" fails, as does the guard that no permission
 *       code appears in the DOM.</li>
 * </ul>
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORDER_ID = "d1000001-0000-4000-8000-0000000000b3";
const LINE_ID = "11111111-0000-4000-8000-0000000000b3";

const { applyDiscountMock, previewDiscountMock } = vi.hoisted(() => ({
  applyDiscountMock: vi.fn(),
  previewDiscountMock: vi.fn(),
}));

let currentOrder: Order;
let currentPayments: OrderPayment[];

vi.mock("@/lib/repositories/pos.repository", () => ({
  PosRepository: {
    getOrder: vi.fn(async () => currentOrder),
    getTables: vi.fn(async () => []),
    getPayments: vi.fn(async () => currentPayments),
    applyDiscount: applyDiscountMock,
    previewDiscount: previewDiscountMock,
    serveAllItems: vi.fn(),
    sendToKds: vi.fn(async () => currentOrder),
    recordPayment: vi.fn(),
  },
}));

/** Rs 450.00 × 2 on one line, plus Rs 1,000.00 on another. No tax, so the arithmetic is readable. */
function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    branchId: "b0000001-0000-4000-8000-000000000001",
    orderNo: "ORD-20260812-0197",
    type: "DINE_IN",
    status: "SENT_TO_KDS",
    derivedStatus: "IN_PROGRESS",
    tableId: null,
    coverCount: 2,
    cashierId: null,
    customerId: null,
    subtotalPaisa: 190000,
    taxPaisa: 0,
    discountPaisa: 0,
    serviceChargePaisa: 0,
    serviceChargePct: 0,
    serviceChargeLabel: null,
    totalPaisa: 190000,
    notes: null,
    openedAt: "2026-08-12T04:30:00Z",
    sentToKdsAt: "2026-08-12T04:32:00Z",
    clientOrderId: "c1000001-0000-4000-8000-0000000000b3",
    version: 3,
    items: [
      {
        id: LINE_ID,
        menuItemId: "aaaaaaaa-0000-4000-8000-0000000000b3",
        itemNameSnapshot: "Seekh Kebab",
        unitPriceSnapshot: 45000,
        quantity: 2,
        kdsStation: "DEFAULT",
        itemStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T04:32:00Z",
        discountPaisa: 0,
        taxPaisa: 0,
        lineTotalPaisa: 90000,
        notes: null,
        modifiers: [],
      },
      {
        id: "11111111-0000-4000-8000-0000000000b4",
        menuItemId: "aaaaaaaa-0000-4000-8000-0000000000b4",
        itemNameSnapshot: "Chicken Karahi",
        unitPriceSnapshot: 100000,
        quantity: 1,
        kdsStation: "DEFAULT",
        itemStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T04:32:00Z",
        discountPaisa: 0,
        taxPaisa: 0,
        lineTotalPaisa: 100000,
        notes: null,
        modifiers: [],
      },
    ],
    discounts: [],
    ...overrides,
  };
}

const CASHIER_PERMS = [
  "pos.order.view",
  "pos.order.update",
  "pos.order.close",
  "pos.order.discount.line",
];
const MANAGER_PERMS = [...CASHIER_PERMS, "pos.order.discount.order", "pos.order.discount.override"];

function renderCharge(permissions: string[] = CASHIER_PERMS) {
  seedSession({ permissions });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <ChargeSummary orderId={ORDER_ID} />
    </Wrapper>,
  );
}

describe("Charge page — giving a discount (B3)", () => {
  beforeEach(() => {
    currentOrder = makeOrder();
    currentPayments = [];
    applyDiscountMock.mockReset();
    applyDiscountMock.mockImplementation(async () => makeOrder());
  });

  afterEach(() => {
    clearSession();
  });

  it("offers a discount control on a check that has already gone to the kitchen", async () => {
    renderCharge();
    expect(await screen.findByTestId("add-discount-button")).toBeInTheDocument();
    expect(screen.getByTestId("add-discount-button")).toHaveTextContent(/apply a discount/i);
  });

  it("refuses to submit until a reason is given, and says which field is missing", async () => {
    const user = userEvent.setup();
    renderCharge();

    await user.click(await screen.findByTestId("add-discount-button"));
    await user.selectOptions(screen.getByTestId("discount-line-select"), LINE_ID);
    await user.type(screen.getByTestId("discount-value-input"), "10");

    const submit = screen.getByTestId("apply-discount-submit");
    expect(submit).toBeDisabled();
    expect(screen.getByTestId("discount-validation-error")).toHaveTextContent(
      /say why the discount is being given/i,
    );

    // Pressing it anyway must send nothing — a disabled control that still fires is worse than
    // no control, because it looks like it worked.
    await user.click(submit);
    expect(applyDiscountMock).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("discount-reason-input"), "Kebab arrived cold");
    await waitFor(() => expect(screen.getByTestId("apply-discount-submit")).toBeEnabled());
  });

  /**
   * D-1 — this test used to assert the defect.
   *
   * Its previous body read, verbatim:
   *
   * <pre>// 10% of 2 × Rs 450.00 = Rs 90.00; Rs 1,900.00 − Rs 90.00 = Rs 1,810.00.</pre>
   *
   * That is gross-minus-discount — the rule that quoted Rs 1,802.00 on a check that charged
   * Rs 1,774.80. The test passed, was named "to the paisa", and pinned the wrong arithmetic in
   * place. It is rewritten rather than deleted so the shape of the mistake stays legible: a
   * preview is only correct if the SERVER said so, and the only way a browser test can assert
   * that is to assert the browser asked and rendered the reply.
   */
  it("renders the server's figures, not its own arithmetic on the gross total", async () => {
    const user = userEvent.setup();
    // What pos-service really returns for 10% off this line: the tax on this fixture is zero,
    // so the movement is visible in the total alone.
    previewDiscountMock.mockResolvedValue({
      amountOffPaisa: 9000,
      subtotalPaisa: 190000,
      discountPaisa: 9000,
      taxPaisa: 0,
      serviceChargePaisa: 0,
      totalPaisa: 181000,
      previousTaxPaisa: 0,
      previousServiceChargePaisa: 0,
      previousTotalPaisa: 190000,
    });
    renderCharge();

    await user.click(await screen.findByTestId("add-discount-button"));
    await user.selectOptions(screen.getByTestId("discount-line-select"), LINE_ID);
    await user.type(screen.getByTestId("discount-value-input"), "10");
    await user.type(screen.getByTestId("discount-reason-input"), "Kebab arrived cold");

    const preview = await screen.findByTestId("discount-preview");
    await waitFor(() => expect(preview).toHaveTextContent(/Rs 1,810\.00/));
    expect(preview).toHaveTextContent(/Rs 90\.00/);

    // It asked the server the question the operator actually typed — the same payload the apply
    // route will receive, so the quote and the charge cannot be answers to different questions.
    expect(previewDiscountMock).toHaveBeenCalledWith(ORDER_ID, {
      scope: "LINE",
      orderItemId: LINE_ID,
      type: "PERCENT",
      value: 10,
      reason: "Kebab arrived cold",
    });
  });

  /**
   * The same screen, with a server whose tax rule moves the total by more than the discount —
   * which is what every real check does and what the browser could never know.
   */
  it("quotes the tax-adjusted total, which is NOT the total minus the discount", async () => {
    const user = userEvent.setup();
    // ORD-20260812-0443's real figures, scaled onto this fixture's shape: Rs 170.00 off a
    // Rs 1,972.00 check leaves Rs 1,774.80, because the tax falls from Rs 272.00 to Rs 244.80.
    previewDiscountMock.mockResolvedValue({
      amountOffPaisa: 17000,
      subtotalPaisa: 170000,
      discountPaisa: 17000,
      taxPaisa: 24480,
      serviceChargePaisa: 0,
      totalPaisa: 177480,
      previousTaxPaisa: 27200,
      previousServiceChargePaisa: 0,
      previousTotalPaisa: 197200,
    });
    renderCharge(MANAGER_PERMS);

    await user.click(await screen.findByTestId("add-discount-button"));
    await user.click(screen.getByTestId("discount-scope-order"));
    await user.type(screen.getByTestId("discount-value-input"), "10");
    await user.type(screen.getByTestId("discount-reason-input"), "Regular of twenty years");

    const preview = await screen.findByTestId("discount-preview");
    await waitFor(() => expect(preview).toHaveTextContent(/Rs 1,774\.80/));

    // The number the old panel printed, and the number a manager read aloud on the floor. If it
    // is anywhere on this screen the defect is back.
    expect(preview).not.toHaveTextContent(/Rs 1,802\.00/);
    expect(document.body.textContent).not.toMatch(/Rs 1,802\.00/);

    // And the movement is EXPLAINED, so the person reading it aloud can check it.
    expect(screen.getByTestId("discount-preview-tax")).toHaveTextContent(/Rs 272\.00/);
    expect(screen.getByTestId("discount-preview-tax")).toHaveTextContent(/Rs 244\.80/);
  });

  it("sends the scope, the line, the value and the reason the operator actually entered", async () => {
    const user = userEvent.setup();
    renderCharge();

    await user.click(await screen.findByTestId("add-discount-button"));
    await user.selectOptions(screen.getByTestId("discount-line-select"), LINE_ID);
    await user.type(screen.getByTestId("discount-value-input"), "10");
    await user.type(screen.getByTestId("discount-reason-input"), "Kebab arrived cold");
    await waitFor(() => expect(screen.getByTestId("apply-discount-submit")).toBeEnabled());
    await user.click(screen.getByTestId("apply-discount-submit"));

    await waitFor(() => expect(applyDiscountMock).toHaveBeenCalledTimes(1));
    expect(applyDiscountMock).toHaveBeenCalledWith(ORDER_ID, {
      scope: "LINE",
      orderItemId: LINE_ID,
      type: "PERCENT",
      value: 10,
      reason: "Kebab arrived cold",
    });
  });

  it("tells a cashier who can approve a whole-check discount, without showing a permission code", async () => {
    const user = userEvent.setup();
    renderCharge(CASHIER_PERMS);

    await user.click(await screen.findByTestId("add-discount-button"));
    await user.click(screen.getByTestId("discount-scope-order"));

    const message = await screen.findByTestId("discount-validation-error");
    expect(message).toHaveTextContent(/approved by a manager/i);
    expect(screen.getByTestId("apply-discount-submit")).toBeDisabled();

    // The exact failure this item names: a raw policy string in front of an operator.
    expect(document.body.textContent).not.toMatch(/pos\.order\.discount/);
    expect(document.body.textContent).not.toMatch(/pos\.pos\./);
  });

  it("lets a manager choose the whole check and submits it as an ORDER-scope discount", async () => {
    const user = userEvent.setup();
    renderCharge(MANAGER_PERMS);

    await user.click(await screen.findByTestId("add-discount-button"));
    await user.click(screen.getByTestId("discount-scope-order"));
    await user.type(screen.getByTestId("discount-value-input"), "10");
    await user.type(screen.getByTestId("discount-reason-input"), "Regular of twenty years");
    await waitFor(() => expect(screen.getByTestId("apply-discount-submit")).toBeEnabled());
    await user.click(screen.getByTestId("apply-discount-submit"));

    await waitFor(() => expect(applyDiscountMock).toHaveBeenCalledTimes(1));
    expect(applyDiscountMock).toHaveBeenCalledWith(ORDER_ID, {
      scope: "ORDER",
      type: "PERCENT",
      value: 10,
      reason: "Regular of twenty years",
    });
  });

  /**
   * D-1 — this one asserted a REFUSAL the server does not make.
   *
   * The panel used to rebuild the server's headroom in the browser and block anything larger.
   * That base double-counted every line discount already on the check (it read
   * `item.discountPaisa`, which is `recomputeOrderTotals`'s output since V27), which is how
   * Rs 213.90 came to be quoted against Rs 208.90 applied. And the refusal was wrong in kind as
   * well as in number: the server CLAMPS an over-large discount rather than rejecting it.
   *
   * So the honest behaviour is to let it through and say what will really come off.
   */
  it("says what will really come off when the operator asks for more than is left", async () => {
    const user = userEvent.setup();
    // Rs 2,000.00 asked of a line worth Rs 900.00 — the server clamps to Rs 900.00.
    previewDiscountMock.mockResolvedValue({
      amountOffPaisa: 90000,
      subtotalPaisa: 190000,
      discountPaisa: 90000,
      taxPaisa: 0,
      serviceChargePaisa: 0,
      totalPaisa: 100000,
      previousTaxPaisa: 0,
      previousServiceChargePaisa: 0,
      previousTotalPaisa: 190000,
    });
    renderCharge();

    await user.click(await screen.findByTestId("add-discount-button"));
    await user.selectOptions(screen.getByTestId("discount-line-select"), LINE_ID);
    await user.click(screen.getByTestId("discount-type-flat"));
    await user.type(screen.getByTestId("discount-value-input"), "2000");
    await user.type(screen.getByTestId("discount-reason-input"), "Comped");

    const capped = await screen.findByTestId("discount-preview-capped");
    expect(capped).toHaveTextContent(/Rs 900\.00/);
    // A legal discount, so it may be given — the old panel disabled the button here.
    await waitFor(() => expect(screen.getByTestId("apply-discount-submit")).toBeEnabled());
  });

  it("shows every discount already on the check with its reason and who authorised it", async () => {
    currentOrder = makeOrder({
      discountPaisa: 9000,
      totalPaisa: 181000,
      discounts: [
        {
          id: "dddddddd-0000-4000-8000-0000000000b3",
          scope: "LINE",
          orderItemId: LINE_ID,
          itemName: "Seekh Kebab",
          type: "PERCENT",
          source: "MANUAL",
          value: 10,
          amountPaisa: 9000,
          reason: "Kebab arrived cold",
          appliedBy: "eb2ee67e-9fc0-4ed5-bb5b-cd6321e02ba1",
          appliedByName: "Terrace Cashier",
          appliedAt: "2026-08-12T04:40:29Z",
        },
      ],
    });
    renderCharge();

    const list = await screen.findByTestId("applied-discounts");
    expect(within(list).getByText(/Kebab arrived cold/)).toBeInTheDocument();
    expect(within(list).getByText(/Terrace Cashier/)).toBeInTheDocument();
    expect(list).toHaveTextContent(/10% off Seekh Kebab/);
    expect(list).toHaveTextContent(/Rs 90\.00/);
  });

  /**
   * An automatic promotion has no `appliedBy` — nobody pressed anything. Before pos V30 this
   * rendering could not be reached at all, because the promotion path violated the
   * `order_discounts_type_check` constraint and 500'd before a row ever existed. Now that it
   * writes, the actor line must not fall through to "Unknown": on a money-adjacent audit list
   * that reads as a LOST record rather than as the truth, which is that no person decided it.
   */
  it("names an automatic promotion as automatic rather than as an unknown person", async () => {
    currentOrder = makeOrder({
      discountPaisa: 15000,
      totalPaisa: 175000,
      discounts: [
        {
          id: "dddddddd-0000-4000-8000-0000000000c7",
          scope: "ORDER",
          orderItemId: null,
          itemName: null,
          // FLAT, not "PROMOTION" — `type` says how `value` is to be read (rupees), and the
          // fact that the engine chose it is a separate axis carried by `source`.
          type: "FLAT",
          source: "PROMOTION",
          value: 150,
          amountPaisa: 15000,
          reason: "Automatic promotion (customer's qualifying offer)",
          appliedBy: null,
          appliedByName: null,
          appliedAt: "2026-08-12T04:40:29Z",
        },
      ],
    });
    renderCharge();

    const list = await screen.findByTestId("applied-discounts");
    expect(within(list).getByText(/Applied automatically/)).toBeInTheDocument();
    expect(list).not.toHaveTextContent(/Unknown/);
    expect(list).toHaveTextContent(/Off the whole check/);
    expect(list).toHaveTextContent(/Rs 150\.00/);
  });

  it("withdraws the control once the check is closed, but keeps the discounts explained", async () => {
    currentOrder = makeOrder({
      status: "CLOSED",
      derivedStatus: "SERVED",
      discountPaisa: 9000,
      totalPaisa: 181000,
      discounts: [
        {
          id: "dddddddd-0000-4000-8000-0000000000b3",
          scope: "LINE",
          orderItemId: LINE_ID,
          itemName: "Seekh Kebab",
          type: "PERCENT",
          source: "MANUAL",
          value: 10,
          amountPaisa: 9000,
          reason: "Kebab arrived cold",
          appliedBy: null,
          appliedByName: "Terrace Cashier",
          appliedAt: "2026-08-12T04:40:29Z",
        },
      ],
    });
    renderCharge();

    expect(await screen.findByTestId("applied-discounts")).toHaveTextContent(/Kebab arrived cold/);
    expect(screen.queryByTestId("add-discount-button")).not.toBeInTheDocument();
  });
});
