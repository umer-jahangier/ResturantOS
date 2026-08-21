"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, X } from "lucide-react";
import { MenuGrid } from "@/components/pos/menu-grid";
import { OrderPanel } from "@/components/pos/order-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useCreateOrder, useAddItem, useOrder } from "@/lib/hooks/pos/use-orders";
import { CustomerPicker } from "@/components/crm/customer-picker";
import type { Customer } from "@/lib/models/crm.model";
import { useFireToKitchen } from "@/lib/hooks/pos/use-fire-to-kitchen";
import { formatUserFacingError } from "@/lib/errors";
import {
  addLine,
  cartLineKey,
  clearCart,
  decrementLine,
  incrementLine,
  modifierIdsOf,
  removeLine,
  type CartLine,
  type CartModifier,
} from "@/components/pos/cart-reducer";
import { ModifierDialog } from "@/components/pos/modifier-dialog";
import { useModifierGroupsByItem } from "@/lib/hooks/pos/use-modifiers";
import type { MenuItem, Order, OrderType } from "@/lib/models/pos.model";

/**
 * What the cashier is shown when a persist/fire attempt dies part-way. `orderNo` is
 * non-null only once the order itself reached the server — the difference between
 * "nothing happened, try again" and "the check exists, only the ticket didn't fire",
 * which are opposite instructions for the person holding the queue.
 */
interface SendFailure {
  /** True once createOrder succeeded — the check is on the server, fired or not. */
  orderPersisted: boolean;
  orderNo: string | null;
  /** One short, user-safe sentence (never a raw status line or Zod dump). */
  reason: string;
}

interface PosTerminalProps {
  /**
   * The page-level selected table (TableFloorView -> page.tsx state) — pre-fills the
   * terminal's own table selector when an AVAILABLE table was tapped. `page.tsx`
   * remounts `PosTerminal` on binding change (`key`); this is only ever read at mount
   * time as the initial value — the terminal's own `table-select-combobox` (D-03) owns
   * the LIVE selection from then on.
   */
  tableId?: string | null;
  /**
   * RESUME an order that already exists on the server ("Full Menu →" out of the
   * Order/Table detail drawer). Read once, at mount, as the initial value of the
   * terminal's own `orderId` — `page.tsx` remounts on a change of binding.
   *
   * <p>Its absence was S0-09: the terminal had no concept of an order it did not itself
   * create, so recalling a parked bill opened a blank cart and the party was rung twice.
   */
  orderId?: string | null;
}

/**
 * The order-taking terminal (POS-16..19/D-01..D-04).
 *
 * <p>Two modes, and which one is live is decided by a single piece of state, `orderId`:
 *
 * <ul>
 *   <li><b>Composing</b> (`orderId == null`) — a client-only cart in local React state.
 *       NOTHING persists to pos-service until the cashier explicitly hits Send to
 *       Kitchen, Save as Draft or Charge; no DRAFT order is ever created on a menu tap.
 *   <li><b>Bound</b> (`orderId != null`) — the order exists server-side, either because
 *       this terminal just persisted it or because it was RESUMED via `orderId`. The
 *       local cart is not even rendered in this mode, so a menu tap must append to the
 *       real order (`useAddItem`) rather than accumulate in an invisible cart.
 * </ul>
 */
export function PosTerminal({ tableId, orderId: resumeOrderId }: PosTerminalProps) {
  const { branchId } = useCurrentUser();
  const router = useRouter();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("DINE_IN");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(tableId ?? null);

  // Non-null once the terminal is BOUND to a server-side order — either resumed via the
  // `orderId` prop, or persisted here (first Send/Draft/Charge succeeded). Gates Charge
  // Now and switches OrderPanel from cart-rendering to server-order-rendering.
  const [orderId, setOrderId] = useState<string | null>(resumeOrderId ?? null);
  // ONE clientOrderId per cart lifetime — preserves idempotency across retries of the
  // SAME persist attempt (RESEARCH POS-16, HIGH risk). Regenerated only on Clear/New
  // Order, never on every render.
  const clientOrderIdRef = useRef<string>(crypto.randomUUID());
  // Guards against a rapid double-click on Send to Kitchen firing TWO concurrent
  // persist attempts before React state (`orderId`) commits on the next render — the
  // same class of stale-read race already fixed once for menu-item taps
  // (pos-terminal.tsx history, `creatingOrderRef`). A plain ref is read/written
  // synchronously within the same event-handler invocation, unlike component state.
  const sendInFlightRef = useRef(false);
  // Menu taps on a BOUND order go to the server one at a time — see handleItemSelect.
  const appendQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * The order a PREVIOUS attempt already created on the server but has not yet fired,
   * plus the cart lines that already landed on it.
   *
   * These exist because pos-service DEDUPES createOrder on clientOrderId
   * (`OrderLifecycleIT#duplicateCreate_sameClientOrderId_returnsSameOrder`): a naive
   * retry of `persistCart` after a mid-persist failure gets the SAME order back and then
   * appends every line to it a second time — "the kitchen gets it twice", the exact
   * second half of this gap's user impact. `persistCart` is therefore resumable: it
   * skips the create when the order exists and skips each line already on it.
   */
  const persistedOrderRef = useRef<Order | null>(null);
  const persistedLineKeysRef = useRef<Set<string>>(new Set());

  /** Non-null while a failed Send is being shown to the cashier (see {@link SendFailure}). */
  const [sendFailure, setSendFailure] = useState<SendFailure | null>(null);

  // The order's CRM customer. Order.customerId has always existed end to end — model,
  // adapter, hook, backend, loyalty consumer — and no screen ever set it, so every order
  // reached crm-service with a null customerId and the loyalty consumer's null-guard was
  // the only branch ever taken. Points accrued on nothing.
  const [customer, setCustomer] = useState<Customer | null>(null);

  const createOrder = useCreateOrder();
  const addItem = useAddItem();
  const fireToKitchen = useFireToKitchen();
  const orderQuery = useOrder(orderId ?? "");
  const sentOrder = orderQuery.data;
  /**
   * A RESUMED order that has not arrived yet. Rendered as its own state rather than
   * falling through to `OrderPanel` — which, with no `sentOrder` and an empty cart,
   * renders "Add items to start an order". That sentence is the exact lie S0-09 is
   * about: it tells a cashier holding a live check that there is no order here. A
   * failed fetch gets `QueryErrorNotice`, never an empty state (GA-001).
   */
  const isHydratingResumedOrder = !!orderId && !sentOrder;

  const isPersisting = createOrder.isPending || addItem.isPending || fireToKitchen.isPending;

  /**
   * The modifier catalogue, indexed by dish (S6) — loaded ONCE beside the menu.
   *
   * <p>Held whole, never destructured to a default of `[]`: a failed read has no trustworthy
   * answer, and treating it as "this dish has no options" would ring a forced group's dish with no
   * choice on it. `handleItemSelect` opens the dialog in that case and the dialog says what
   * happened.
   */
  const modifierIndex = useModifierGroupsByItem();
  /** The dish whose configure dialog is open, or null. */
  const [configuringItem, setConfiguringItem] = useState<MenuItem | null>(null);

  /**
   * Menu tap, and which of the terminal's two modes is live decides where it lands.
   *
   * <p><b>Composing</b> — cart-only, NEVER a network call (POS-16/D-01). No DRAFT order
   * is created by a tap.
   *
   * <p><b>Bound</b> — appends to THAT order, server-side, as a new PENDING line at
   * revision 0, which is precisely what the panel's "Send New Items (N)" CTA then fires
   * as the next revision. This branch did not exist: a tap on a bound order fell into
   * the local cart, and the local cart is not rendered once an order is bound (OrderPanel
   * switches to server-order rendering). The item was therefore on no screen, on no
   * check and in no error — it simply evaporated. That is the second half of S0-09: a
   * resumed order the cashier cannot actually add to is not a resumed order.
   */
  const commitItem = useCallback(
    (item: MenuItem, modifiers: CartModifier[]) => {
      if (!orderId) {
        setCart((prev) =>
          addLine(prev, {
            menuItemId: item.id,
            name: item.name,
            unitPricePaisa: item.basePricePaisa,
            // F16: the rate the SERVER resolved (item class -> category class -> legacy column),
            // not the item's own legacy column. Reading `item.taxRatePct` here priced a cart at
            // 0% for every dish whose rate lives on its category — which, after this feature
            // ships, is most of them.
            taxRatePct: item.effectiveTaxRatePct,
            modifiers,
          }),
        );
        return;
      }

      // Serialised through ONE promise chain rather than fired concurrently: the order
      // row carries an @Version, and two appends in flight together lose that race and
      // surface as an optimistic-lock failure. On a real till "two taps in flight
      // together" is just a cashier working at speed, so it must be ordinary, not an
      // error. `.catch` first so one failed append never wedges the queue.
      appendQueueRef.current = appendQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await addItem.mutateAsync({
              orderId,
              payload: {
                menuItemId: item.id,
                branchId,
                quantity: 1,
                ...(modifiers.length > 0 ? { modifierIds: modifiers.map((m) => m.id) } : {}),
              },
            });
            toast.success(`${item.name} added`);
          } catch (error) {
            toast.error(`Couldn't add ${item.name}. ${formatUserFacingError(error)}`);
          }
        });
    },
    [orderId, addItem, branchId],
  );

  /**
   * Menu tap (S6). A dish that carries modifier groups opens the configure dialog; a dish that
   * carries none goes straight to the cart, exactly as it always has.
   *
   * <p>The catalogue was loaded ONCE with the menu, so this branch is a Map lookup and not a
   * network round trip — the difference between a till that responds to a finger and one that
   * pauses on every tap.
   *
   * <h3>The three states, and why the failed one still rings</h3>
   *
   * <ul>
   *   <li><b>Known, has groups</b> → the dialog, enforced.</li>
   *   <li><b>Known, no groups</b> → straight to the cart, exactly as before this feature.</li>
   *   <li><b>Still loading</b> → the dialog, which shows a skeleton and fills in. The tap is
   *       honoured rather than dropped, and the window is sub-second.</li>
   *   <li><b>The read FAILED</b> → straight to the cart. Not a shortcut: the catalogue is served
   *       by pos-service, the same service {@code addItem} goes to, so a failed catalogue read
   *       means the till cannot ring anything at all — and opening a modal on every tap of the
   *       ninety percent of dishes that have no options would make the outage worse rather than
   *       safer. The guard that matters is {@code ModifierSelectionResolver} on the server, which
   *       refuses a forced group with nothing chosen no matter which client asks.</li>
   * </ul>
   */
  const handleItemSelect = useCallback(
    (item: MenuItem) => {
      const known = modifierIndex.byItem?.get(item.id);
      const stillLoading = modifierIndex.byItem === undefined && !modifierIndex.isError;
      if (stillLoading || (known && known.some((g) => g.active))) {
        setConfiguringItem(item);
        return;
      }
      commitItem(item, []);
    },
    [commitItem, modifierIndex.byItem, modifierIndex.isError],
  );

  const handleIncrement = useCallback((key: string) => {
    setCart((prev) => incrementLine(prev, key));
  }, []);

  const handleDecrement = useCallback((key: string) => {
    setCart((prev) => decrementLine(prev, key));
  }, []);

  const handleRemove = useCallback((key: string) => {
    setCart((prev) => removeLine(prev, key));
  }, []);

  /** "Clear All" (pre-send only) — empties the cart itself; order type/table stay as-is. */
  const handleClearCart = useCallback(() => {
    setCart(clearCart());
  }, []);

  /** Forgets any partially-persisted order so the next attempt starts a brand-new check. */
  const resetPersistProgress = useCallback(() => {
    persistedOrderRef.current = null;
    persistedLineKeysRef.current = new Set();
    clientOrderIdRef.current = crypto.randomUUID();
  }, []);

  const handleClearNewOrder = useCallback(() => {
    setCart(clearCart());
    setOrderType("DINE_IN");
    setSelectedTableId(tableId ?? null);
    setOrderId(null);
    setSendFailure(null);
    resetPersistProgress();
    setCustomer(null);
  }, [tableId, resetPersistProgress]);

  /**
   * Lazy persist (POS-16/D-01): creates the order ONCE (single clientOrderId, reused
   * across any retry of this same attempt), then adds every cart line sequentially so
   * each lands before the next. Shared by Send to Kitchen / Save as Draft / Charge Now —
   * the only difference between those is what happens AFTER the cart is persisted (fire,
   * park, or navigate to charge). Reuses the existing hooks AS-IS (ORDER_CREATED,
   * table-occupancy sync, offline-outbox behaviour preserved). Returns the new order.
   */
  const persistCart = useCallback(async () => {
    if (!persistedOrderRef.current) {
      persistedOrderRef.current = await createOrder.mutateAsync({
        branchId,
        clientOrderId: clientOrderIdRef.current,
        type: orderType,
        coverCount: 1,
        ...(selectedTableId ? { tableId: selectedTableId } : {}),
        ...(customer ? { customerId: customer.id } : {}),
      });
      persistedLineKeysRef.current = new Set();
    }
    const newOrder = persistedOrderRef.current;

    for (const line of cart) {
      // Resume, never repeat: a line the previous attempt already got onto this order
      // must not be added again (see the persistedOrderRef note above).
      const modifierIds = modifierIdsOf(line);
      const key = cartLineKey(line.menuItemId, modifierIds, line.notes);
      if (persistedLineKeysRef.current.has(key)) continue;
      const afterLine = await addItem.mutateAsync({
        orderId: newOrder.id,
        payload: {
          menuItemId: line.menuItemId,
          branchId,
          quantity: line.quantity,
          ...(modifierIds.length > 0 ? { modifierIds } : {}),
          ...(line.notes ? { notes: line.notes } : {}),
        },
      });
      // Keep the freshest server copy, NOT the create response. pos-service assigns
      // `orderNo` on the DRAFT->OPEN transition, which is the FIRST addItem — so the
      // create response's orderNo is always null. Returning that one is why "Saved as
      // draft — ORD-…" printed as a bare "Saved as draft.", leaving the cashier with no
      // number to find the parked check by, and why the send-failure banner could only
      // ever say "was saved" instead of naming the order.
      persistedOrderRef.current = afterLine;
      persistedLineKeysRef.current.add(key);
    }
    return persistedOrderRef.current ?? newOrder;
  }, [cart, createOrder, addItem, branchId, orderType, selectedTableId, customer]);

  /**
   * Send to Kitchen. Three rules this handler exists to hold, each of which it broke before:
   *
   *  1. **Nothing fails silently.** Every rejection lands in a `catch` that raises a
   *     `role="alert"` banner AND a toast. Previously `try/finally` with no `catch` let the
   *     rejection escape as an unhandled promise: a 503 left the cart full and the button
   *     enabled with no message at all, which a cashier reads as "the tap didn't register".
   *  2. **The cart is only dropped once the ticket is actually on the pass.**
   *     `setCart(clearCart())` used to run BEFORE `fireToKitchen` was awaited, so a failed
   *     fire emptied the cart while the order sat on the server unfired.
   *  3. **A retry fires the existing order — it never re-persists it.** See
   *     `persistedOrderRef`.
   */
  const handleSendToKitchen = useCallback(async () => {
    if (orderId || sendInFlightRef.current) return;
    // A previously-persisted-but-unfired order is sendable even though the cart is what
    // the cashier sees; an empty cart with nothing persisted is not.
    if (cart.length === 0 && !persistedOrderRef.current) return;
    sendInFlightRef.current = true;
    setSendFailure(null);
    try {
      const newOrder = await persistCart();
      // `null` means the fire was QUEUED in the outbox because the line is down — the
      // ticket is NOT on the pass yet (S0-07). Saying "Sent to kitchen" here is the exact
      // sentence that made a cashier stop watching an order the kitchen never received.
      const fired = await fireToKitchen.mutateAsync({ orderId: newOrder.id });
      // Fired (or safely queued). Only now is it safe to hand the panel over to the
      // order and drop the local cart.
      persistedOrderRef.current = null;
      persistedLineKeysRef.current = new Set();
      setOrderId(newOrder.id);
      setCart(clearCart());
      if (fired) {
        toast.success(`Sent to kitchen${newOrder.orderNo ? ` — ${newOrder.orderNo}` : ""}.`);
      } else {
        toast.warning(
          "Offline — ticket queued. It reaches the kitchen as soon as the connection returns.",
        );
      }
    } catch (error) {
      const persisted = persistedOrderRef.current;
      setSendFailure({
        orderPersisted: persisted !== null,
        orderNo: persisted?.orderNo ?? null,
        reason: formatUserFacingError(error),
      });
      toast.error(
        persisted
          ? `Not sent to the kitchen. Order ${persisted.orderNo ?? "was saved"} is saved — press Send to Kitchen again.`
          : "Couldn't send to the kitchen. Your items are still in the cart — try again.",
      );
    } finally {
      sendInFlightRef.current = false;
    }
  }, [cart, orderId, persistCart, fireToKitchen]);

  /**
   * Charge Now (pre-send): persists the cart WITHOUT firing to the kitchen, then navigates to
   * the full-page charge surface. Payment happens FIRST; the kitchen is fired only AFTER the
   * order is fully paid (ChargeSummary handles that, gated on `sentToKdsAt == null`). This keeps
   * the two flows fully isolated: an order that was already sent to the kitchen and is charged
   * at the end is NOT re-fired (its sentToKdsAt is set). The terminal unmounts on navigation.
   */
  const handleChargeNow = useCallback(async () => {
    if (cart.length === 0 && !persistedOrderRef.current) return;
    if (orderId || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setSendFailure(null);
    try {
      const newOrder = await persistCart();
      router.push(`/app/pos/orders/${newOrder.id}/charge`);
    } catch (error) {
      // Same two-outcome split as Send to Kitchen: a half-persisted check must name its
      // own order number, otherwise the cashier cannot find what the product just made.
      const persisted = persistedOrderRef.current;
      setSendFailure({
        orderPersisted: persisted !== null,
        orderNo: persisted?.orderNo ?? null,
        reason: formatUserFacingError(error),
      });
      toast.error("Couldn't start charge. Please try again.");
      sendInFlightRef.current = false;
    }
  }, [cart, orderId, persistCart, router]);

  /**
   * Save as Draft (explicit park): persists the cart WITHOUT firing to the kitchen — it
   * lands with every line PENDING (derivedStatus DRAFT), so it shows under Order
   * Management's "Draft" filter, resumable or cancelable there. Resets the terminal to a
   * clean cart for the next customer.
   */
  const handleSaveAsDraft = useCallback(async () => {
    if (cart.length === 0 && !persistedOrderRef.current) return;
    if (orderId || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setSendFailure(null);
    try {
      const newOrder = await persistCart();
      setCart(clearCart());
      setOrderType("DINE_IN");
      setSelectedTableId(tableId ?? null);
      setOrderId(null);
      resetPersistProgress();
      toast.success(
        `Saved as draft${newOrder.orderNo ? ` — ${newOrder.orderNo}` : ""}. Find it in Order Management.`,
      );
    } catch (error) {
      const persisted = persistedOrderRef.current;
      setSendFailure({
        orderPersisted: persisted !== null,
        orderNo: persisted?.orderNo ?? null,
        reason: formatUserFacingError(error),
      });
      toast.error("Failed to save draft. Please try again.");
    } finally {
      sendInFlightRef.current = false;
    }
  }, [cart, orderId, persistCart, tableId, resetPersistProgress]);

  return (
    // Plain flex column — deliberately no transform/filter/backdrop-filter on this
    // layout ancestor; those break the receipt print path.
    <div className="flex h-full flex-col gap-0 overflow-hidden">
      {sendFailure && (
        <SendFailureBanner failure={sendFailure} onDismiss={() => setSendFailure(null)} />
      )}
      {/*
        Two columns on a till, STACKED on a phone.

        <p>It was `flex` with a `flex-1` grid beside a fixed `w-80` panel at every width. On a
        390px screen that leaves the entire menu <b>37px wide</b> — measured, not estimated
        (`.planning/audits/floor/S6/s6-responsive.json`, `terminal.gridWidth`). Every tile is a
        sliver its own container swallows the tap on, so the menu is not merely cramped, it is
        inoperable: a cashier on a phone cannot ring anything at all, and the configure dialog
        behind those tiles cannot be reached.

        <p>Below `lg` the panel goes full-width underneath and is capped at 32vh so the MENU keeps
        the screen. 32 rather than a comfortable half is measured, not chosen: the page chrome on a
        390x844 phone (till strip, three tabs, search, wrapped category pills) already consumes
        ~520px, so a taller panel pushes the first tile below the fold and the cashier cannot tap
        the dish at all. The panel's own list still scrolls inside that cap. `lg` rather than `md` because a 768px tablet held in portrait is
        the other size a till is actually used at, and two columns there leaves the grid 159px —
        75px tiles, under the 100px minimum a thumb needs. Deliberately no
        transform/filter/backdrop-filter anywhere on this ancestor chain — those break the receipt
        print path.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden lg:flex-row">
        {/* Menu grid — full width on a phone, the wide column on a till */}
        <div className="min-h-0 flex-1 overflow-hidden border-b lg:border-b-0 lg:border-r">
          <MenuGrid
            onItemSelect={handleItemSelect}
            cart={cart}
            onRemove={handleRemove}
            onClearCart={handleClearCart}
          />
        </div>

        {/* Order panel — under the menu on a phone, a fixed column on a till */}
        <div className="flex max-h-[32vh] w-full min-h-0 shrink-0 flex-col overflow-hidden lg:max-h-none lg:w-80">
          <div className="border-b p-3">
            <CustomerPicker
              value={customer}
              onChange={setCustomer}
              disabled={isPersisting || sentOrder !== undefined}
            />
          </div>
          {isHydratingResumedOrder ? (
            <ResumingOrderPanel
              isError={orderQuery.isError}
              error={orderQuery.error}
              isRetrying={orderQuery.isFetching}
              onRetry={() => void orderQuery.refetch()}
            />
          ) : (
            <OrderPanel
              cart={cart}
              orderType={orderType}
              onOrderTypeChange={setOrderType}
              tableId={selectedTableId}
              onTableChange={setSelectedTableId}
              onIncrement={handleIncrement}
              onDecrement={handleDecrement}
              onRemove={handleRemove}
              sentOrder={sentOrder ?? null}
              isPersisting={isPersisting}
              onSendToKitchen={handleSendToKitchen}
              onSaveAsDraft={handleSaveAsDraft}
              onChargeNow={handleChargeNow}
              onClearNewOrder={handleClearNewOrder}
            />
          )}
        </div>
      </div>

      {/* S6 — tap-to-configure. Mounted once here rather than inside MenuGrid so the dialog
          survives a category switch, and so the terminal (which owns the cart and the bound
          order) is the one thing that decides where a configured line lands. */}
      <ModifierDialog
        item={configuringItem}
        groups={configuringItem ? (modifierIndex.byItem?.get(configuringItem.id) ?? []) : []}
        isLoading={modifierIndex.isLoading}
        isError={modifierIndex.isError}
        error={modifierIndex.error}
        isRetrying={modifierIndex.isFetching}
        onRetry={modifierIndex.refetch}
        onCancel={() => setConfiguringItem(null)}
        onConfirm={(modifiers) => {
          if (configuringItem) commitItem(configuringItem, modifiers);
          setConfiguringItem(null);
        }}
      />
    </div>
  );
}

/**
 * The order panel while a RESUMED order is being fetched, and if that fetch fails.
 *
 * <p>Contextual skeleton, not a spinner (DESIGN-BRIEF §24) — three line-shaped rows in
 * the panel's own dimensions, so the surface reads as "your order is arriving" rather
 * than "there is nothing here". On failure, the shared `QueryErrorNotice` (§27): what
 * happened, in the reader's words, with a Try again. Never an empty state — telling a
 * cashier the check is empty when the read merely failed is the GA-001 defect.
 */
function ResumingOrderPanel({
  isError,
  error,
  isRetrying,
  onRetry,
}: {
  isError: boolean;
  error: unknown;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  if (isError) {
    return (
      <div className="flex h-full min-h-0 flex-col p-3">
        <QueryErrorNotice
          what="this order"
          error={error}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 p-3"
      data-testid="resuming-order-skeleton"
      aria-busy="true"
    >
      <p className="text-xs text-muted-foreground">Opening this order…</p>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <div className="flex-1" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

/**
 * The failure surface for a Send/Charge/Draft that did not complete (DESIGN-BRIEF §27:
 * say what happened, say what to do, never a raw status line). It is a `role="alert"`
 * that STAYS on screen — a toast alone is gone in four seconds, and this is the one
 * message that decides whether the cashier rings the guest a second time.
 */
function SendFailureBanner({
  failure,
  onDismiss,
}: {
  failure: SendFailure;
  onDismiss: () => void;
}) {
  const title = failure.orderPersisted
    ? `Order ${failure.orderNo ?? "was saved"} was NOT sent to the kitchen`
    : "Not sent — nothing was saved";
  const instruction = failure.orderPersisted
    ? `The check is saved${failure.orderNo ? ` as ${failure.orderNo}` : ""} and is waiting in Order Management. Press Send to Kitchen again to fire it — do not ring these items a second time.`
    : "Your items are still in the cart. Check the connection, then press Send to Kitchen again.";

  return (
    <Alert
      variant="destructive"
      data-testid="send-failure-alert"
      className="shrink-0 rounded-none border-x-0 border-t-0 border-b-destructive/40 bg-destructive/10 px-4 py-3"
    >
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {failure.reason} {instruction}
      </AlertDescription>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss send failure"
        data-testid="send-failure-dismiss"
        className="absolute right-2 top-2 flex min-h-[32px] min-w-[32px] items-center justify-center rounded text-destructive/70 hover:text-destructive"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </Alert>
  );
}
