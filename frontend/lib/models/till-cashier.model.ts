/**
 * Someone a duty manager may count a float into a drawer for, at this branch (F11).
 *
 * <p>The walkthrough §0 finding: `openTill` bound the session to whoever pressed the button, so a
 * manager who opened a Rs 5,000.00 float opened THEIR OWN drawer and the cashier's terminal still
 * read "No active till". Handing a drawer over needs a person to hand it to, and that is what this
 * type is.
 */
export interface EligibleCashier {
  userId: string;
  /** What to show. Server-side this is the full name falling back to the login address. */
  name: string;
  email: string;
  /** Their role at THIS branch. */
  roleCode: string;
  /**
   * They already hold an open drawer.
   *
   * <p>Carried so the picker can say so BEFORE the manager counts a float — the alternative is a
   * 409 after the fact, which arrives at the moment the cash is already on the counter.
   */
  hasOpenTill: boolean;
}

/**
 * Open a till session on behalf of a named cashier.
 *
 * <p>Deliberately a separate payload from `OpenTillPayload` (which has no `cashierId` and means
 * "my own drawer"). They are two different acts: one is a cashier starting their shift, the other
 * is a supervisor taking custody of a float on somebody else's behalf, gated on
 * `pos.till.open.other` and recorded with both people on the TILL_OPENED event.
 */
export interface OpenTillForCashierPayload {
  branchId: string;
  openingFloatPaisa: number;
  cashierId: string;
}
