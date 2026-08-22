"use client";

import { useState } from "react";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PageBody } from "@/components/ui/page-body";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { TableFloorView } from "@/components/pos/table-floor-view";
import type { FullMenuTarget } from "@/components/pos/order-table-detail-drawer";
import { TillSessionBar } from "@/components/pos/till-session-bar";
import { OrderManagement } from "@/components/pos/order-management";
import { PosConnectionBadge } from "@/components/pos/pos-connection-badge";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { useActiveTill } from "@/lib/hooks/pos/use-till";
import { usePosOrdersSocket } from "@/lib/hooks/pos/use-pos-orders-socket";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

type PosView = "terminal" | "floor" | "orders";

const TABS: { id: PosView; label: string }[] = [
  { id: "terminal", label: "POS Terminal" },
  { id: "floor", label: "Floor View" },
  { id: "orders", label: "Order Management" },
];

export default function PosPage() {
  const [view, setView] = useState<PosView>("terminal");
  /**
   * What the Terminal tab is currently bound to (UI-SPEC §1/§3).
   *
   * `tableId` — the floor view sets it on an AVAILABLE tap so the NEXT order is created
   * against that table. `orderId` — "Full Menu →" sets it so the terminal RESUMES an
   * order that already exists on the server instead of opening a blank cart. Before
   * this, only `tableId` crossed the seam and a recalled bill was silently abandoned
   * (S0-09): the cashier rang the same party a second time and the guest got two checks.
   *
   * `PosTerminal` is remounted on any change of binding (`key` below), which is what
   * resets its in-progress cart — an order id must never leak from one party to the next.
   */
  const [terminalBinding, setTerminalBinding] = useState<FullMenuTarget>({
    orderId: null,
    tableId: null,
  });

  const openInTerminal = (target: FullMenuTarget) => {
    setTerminalBinding(target);
    setView("terminal");
  };

  const tillQuery = useActiveTill();
  const activeTill = tillQuery.data;
  const tillLoading = tillQuery.isLoading;
  // Financial-integrity gate (mirrors the server-authoritative NO_OPEN_TILL guard in
  // OrderServiceImpl.createOrder): a cashier must not even be able to START an order
  // without an OPEN till. Only block on a CONFIRMED absence (query resolved to null) —
  // never while the till query is still loading, so a momentary undefined doesn't flash
  // the notice. The backend remains the source of truth; this is defense-in-depth UX.
  //
  // S1-09: `!tillQuery.isError` is the load-bearing clause. Without it a FAILED till read was
  // indistinguishable from a resolved absence — `data` is undefined either way — so with
  // pos-service stopped the whole terminal rendered "Your till is closed. Open your till from the
  // bar above… Orders can't be created without an open drawer." That is not merely unhelpful: it
  // is a confident wrong diagnosis that sends the cashier to press Open Till, which then also
  // fails, on a screen carrying zero [role=alert]. Measured live on 2026-08-12 with four gateway
  // 503s on the network tab and that sentence on screen.
  const tillClosed = !tillLoading && !tillQuery.isError && !activeTill;
  const tillUnavailable = tillQuery.isError;

  // One branch-level order WebSocket for the whole POS surface (persists across tab
  // switches). Pushes live kitchen→pos order updates into the TanStack cache; the per-order
  // poll in useOrder is now just a relaxed fallback. `isConnected` drives the Live/Polling dot.
  const { branchId } = useCurrentUser();
  const { isConnected } = usePosOrdersSocket({ branchId });

  return (
    <FeatureGuard
      feature="FEATURE_POS"
      fallback={
        <div className="flex items-center justify-center h-full text-muted-foreground">
          POS feature is not enabled for this account.
        </div>
      }
    >
      <PermissionGuard
        require="pos.order.update"
        fallback={
          <div className="flex items-center justify-center h-full text-muted-foreground">
            You do not have permission to access the POS terminal.
          </div>
        }
      >
        {/*
          Full-bleed (UI-SPEC §5, D-38-02). `PageBody fullBleed` emits `data-page-body`, which is
          what strips the back-office gutter off `<main>` via the `main:has([data-page-body])`
          rule in globals.css. Without it the terminal renders inside 16-24px of chrome padding
          it cannot decline — the audit's "dark board floating in light chrome", one screen over.

          Deliberately plain: no transform, filter, backdrop-filter, perspective, will-change or
          contain on this ancestor chain. `receipt-print.css:180` anchors the bill with
          `position: fixed`, and any one of those on an ancestor makes it the containing block
          for fixed descendants at print time as well as on screen.
        */}
        <PageBody fullBleed className="flex flex-col">
          {/*
            The page's one <h1>, and it is deliberately sr-only.

            `h1Count` was 0 here, so a screen-reader user landing on the terminal got no page
            identity at all and the document outline had nothing to anchor on (audit §6.2, §9).
            But this is an `operational` full-bleed surface where vertical space is the scarce
            resource — a visible 20px page title would push the tile grid down on every tablet,
            on the one screen the brief says to optimise for speed above all else (§15, §65).

            The tab bar immediately below names the current view visibly, so sighted users are
            not missing information. This restores the semantics without spending the pixels.
          */}
          <h1 className="sr-only">Point of sale</h1>

          {/* Till session — page-level chrome, session-scoped (not per-tab/per-order),
              visible identically across every tab (UI-SPEC §3). */}
          <TillSessionBar activeTill={activeTill} readFailed={tillUnavailable} />

          {/* View tabs */}
          {/*
            One scrolling row, never a wrapped block. At 390px the three labels wrapped to two
            lines each — "POS / Terminal", "Floor / View", "Order / Management" — spending ~40px of
            the scarcest axis on a screen where the audit already measured the first menu tile
            pushed below the fold. A tab strip is a rail; it scrolls.
          */}
          <div className="relative flex items-center gap-1 overflow-x-auto border-b bg-background px-4 pt-3 shrink-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                className={`min-h-11 shrink-0 whitespace-nowrap px-4 py-2 text-pos font-medium border-b-2 transition-colors ${
                  view === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
            {/* Offline / Live / Polling. Connectivity outranks socket state — a
                WebSocket keeps claiming it is open after the network drops (S0-07). */}
            <PosConnectionBadge isConnected={isConnected} />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {view === "terminal" &&
              (tillUnavailable ? (
                /*
                 * The till read FAILED. Not "no till" — no answer. The distinction is the whole of
                 * S1-09 on this screen, and the copy says out loud both what is unavailable and
                 * what still works, because a cashier who believes the entire product is dead
                 * sends the queue away.
                 */
                <div className="flex h-full items-start justify-center overflow-auto p-6">
                  <div className="w-full max-w-xl">
                    <QueryErrorNotice
                      what="the till"
                      moduleLabel="POS"
                      error={tillQuery.error}
                      stillWorks="Orders already sent to the kitchen are unaffected, and the kitchen display keeps working. Do not take cash against a check you cannot see here."
                      isRetrying={tillQuery.isFetching}
                      onRetry={() => void tillQuery.refetch()}
                    />
                  </div>
                </div>
              ) : tillClosed ? (
                <div
                  data-testid="pos-till-closed-notice"
                  className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
                >
                  <p className="text-h2 font-medium text-foreground">Your till is closed</p>
                  <p className="max-w-sm text-body text-muted-foreground">
                    Open your till from the bar above — recording the counted starting float —
                    before taking any orders. Orders can&apos;t be created without an open drawer.
                  </p>
                </div>
              ) : (
                <PosTerminal
                  key={terminalBinding.orderId ?? terminalBinding.tableId ?? "unbound"}
                  orderId={terminalBinding.orderId}
                  tableId={terminalBinding.tableId}
                />
              ))}
            {view === "floor" && (
              <TableFloorView
                onTableSelect={(table) => {
                  // Only an AVAILABLE tap switches to the terminal to start a new order
                  // (UI-SPEC §2) — and it is a NEW order, so no orderId is carried.
                  // OCCUPIED/NEEDS_BUSSING open the Table Detail drawer instead.
                  if (table.status === "AVAILABLE") {
                    openInTerminal({ orderId: null, tableId: table.id });
                  } else {
                    setTerminalBinding((prev) => ({ ...prev, tableId: table.id }));
                  }
                }}
                // "Full Menu →" from a live table's drawer resumes THAT table's order.
                onFullMenu={openInTerminal}
              />
            )}
            {view === "orders" && (
              <OrderManagement
                // "Full Menu →" (drawer) carries the order being viewed, so the terminal
                // resumes it. "Go to POS" (empty state) carries neither and just opens a
                // fresh cart.
                onFullMenu={openInTerminal}
              />
            )}
          </div>
        </PageBody>
      </PermissionGuard>
    </FeatureGuard>
  );
}
