"use client";

import { useState } from "react";
import { useMockGrn, usePurchaseOrder } from "@/lib/hooks/purchasing/use-purchasing";

// 10-12 gap closure: PurchaseOrderDto.LineDto (backend) does not carry a "received to date" field
// today, so this panel cannot show a running received total per line — only ordered qty. Each
// input defaults to the line's ordered qty ("Receive all in full" convenience), but every input is
// INDEPENDENT: a user can lower any one of them to express a genuine partial receipt on that line
// only. Noted in 10-12-SUMMARY.md for 10-13/verification.
export function MockGrnReceivePanel({ poId }: { poId: string }) {
  const { data: po } = usePurchaseOrder(poId);
  const mockReceive = useMockGrn(poId);
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  // "Store info from previous render" (React-documented pattern, not a useEffect+setState — this
  // project's `react-hooks/set-state-in-effect` ESLint rule forbids that; precedent:
  // `useKeepPreviousData` in the purchasing analytics page) — re-seed defaults only when the line
  // SET changes (e.g. navigating to a different PO), so in-progress edits survive an invalidated
  // refetch of the same PO.
  const [seededForLineIds, setSeededForLineIds] = useState<string | null>(null);
  const lineIds = po?.lines.map((l) => l.id).join(",") ?? "";
  if (po && lineIds !== seededForLineIds) {
    setSeededForLineIds(lineIds);
    setQtyByLine(Object.fromEntries(po.lines.map((l) => [l.id, l.qty])));
  }

  if (!po || po.status === "FULLY_RECEIVED" || po.status === "CLOSED") return null;

  function setQty(lineId: string, value: string) {
    setQtyByLine((prev) => ({ ...prev, [lineId]: value }));
  }

  function receiveAllInFull() {
    if (!po) return;
    setQtyByLine(Object.fromEntries(po.lines.map((l) => [l.id, l.qty])));
  }

  const hasAnyPositiveQty = Object.values(qtyByLine).some((v) => Number(v) > 0);
  const hasInvalidQty = po.lines.some((l) => {
    const v = Number(qtyByLine[l.id] ?? "0");
    return !Number.isFinite(v) || v < 0 || v > Number(l.qty);
  });

  function submit() {
    if (!po) return;
    mockReceive.mutate(
      po.lines.map((l) => ({ poLineId: l.id, receivedQty: qtyByLine[l.id] ?? "0" })),
    );
  }

  return (
    <div className="rounded border border-dashed border-amber-400 bg-amber-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Mock goods receipt (dev)</h3>
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          onClick={receiveAllInFull}
        >
          Receive all in full
        </button>
      </div>
      <p className="text-sm text-muted-foreground">Simulates Phase 8 GRN while integration-mode=mock.</p>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1 font-medium">Line</th>
            <th className="py-1 font-medium">Ordered qty</th>
            <th className="py-1 font-medium">Receive qty</th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((line) => {
            const value = qtyByLine[line.id] ?? "0";
            const invalid = Number(value) < 0 || Number(value) > Number(line.qty);
            return (
              <tr key={line.id} className="border-b last:border-0">
                <td className="py-1">{line.ingredientId.slice(0, 8)}… ({line.uom})</td>
                <td className="py-1">{line.qty}</td>
                <td className="py-1">
                  <input
                    className="w-24 rounded border px-2 py-1 text-sm aria-invalid:border-destructive"
                    inputMode="decimal"
                    value={value}
                    aria-label={`Received quantity for line ${line.id}`}
                    aria-invalid={invalid}
                    onChange={(e) => setQty(line.id, e.target.value)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button
        type="button"
        className="mt-3 rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        disabled={mockReceive.isPending || !hasAnyPositiveQty || hasInvalidQty}
        onClick={submit}
      >
        {mockReceive.isPending ? "Receiving…" : "Mock receive"}
      </button>
    </div>
  );
}
