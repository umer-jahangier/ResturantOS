/**
 * A short, stable reference for a purchase order.
 *
 * <h3>This is a stopgap and it is labelled as one</h3>
 *
 * The endpoint exposes no PO number — measured, its keys are `branchId closeReason closedAt
 * expectedDeliveryDate id lines notes requesterId requiredTiers status submittedAt tiersApproved
 * totalPaisa vendorId` — so there is nothing human to render. The list used to print
 * `ca6ed037…`: a purchase-order list in which no purchase order can be identified.
 *
 * <p>The honest fix is to stop *claiming* to render a business identifier: the column is headed
 * "Reference", never "PO number", and the shortfall is recorded in `38-AUDIT.md` §10.1c as
 * backend work rather than disguised with better typography.
 *
 * <h3>Why it moved out of the list page</h3>
 *
 * Three screens name a purchase order — the PO list, the invoice list and the payables worklist.
 * With the function living on one of them, the other two each shipped their own
 * `id.slice(0, 8) + "…"`, in lower case, with a trailing ellipsis. The same order therefore
 * appeared as `CA6ED037` on one screen and `ca6ed037…` on the next, which is worse than either
 * spelling alone: it makes two references to one order look like two orders.
 */
export function poReference(po: { id: string }): string {
  return po.id.slice(0, 8).toUpperCase();
}
