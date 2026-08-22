import type { MenuItem } from "@/lib/models/pos.model";

/**
 * Whether a dish can be rung right now (UI-SPEC §9.2 "Product card": name · price · image where
 * available · **availability** · quick-add).
 *
 * <h3>What this is, and — more importantly — what it is NOT</h3>
 *
 * The demo's POS tile carries a three-state availability dot: green `Available`, gold `Low Stock`,
 * red `Out` (`demo-calibration/DEMO-SCREENS.md` §3). Two of those three states **have no source in
 * this system**, and inventing them is precisely the defect D-38-16 exists to prevent.
 *
 * Traced end to end before writing this file:
 *
 * <ul>
 *   <li>`MenuItem` (`lib/models/pos.model.ts`) carries no stock, par-level, 86 or availability
 *       field.</li>
 *   <li>Neither does the backend entity — `pos-service/domain/model/MenuItem.java` has exactly one
 *       boolean, `active`.</li>
 *   <li>There is no ingredient→dish depletion path reaching the till: `grep -rn 'availab'` across
 *       `frontend/lib` and `frontend/components` returns nothing menu-related.</li>
 * </ul>
 *
 * So `Low Stock` would be a gold dot over a number nobody computes — the Menu Margin Ranking
 * defect (D-38-16) transplanted onto a touchscreen, where a cashier would act on it. It is not
 * built, and this comment is here so the next reader knows the omission was measured rather than
 * missed.
 *
 * <h3>The one state that IS real</h3>
 *
 * `active`. A deactivated dish is off the card, and the till must not sell it. That fact reached
 * the grid before this change and was rendered as *nothing at all*: the row was silently dropped
 * from the array, so a cashier hunting a dish that had been pulled ten minutes ago found an empty
 * search result and no explanation. An absence is not an answer.
 *
 * <p>Note that `PosRepository.getMenuItems` is already active-only server-side, so in practice
 * this returns `available` for every row a real till receives. That is the intended state of
 * affairs, not evidence the channel is decorative: it is the seam a real 86 signal plugs into, it
 * is what makes an unexpected inactive row legible instead of invisible, and it is asserted by
 * test rather than assumed.
 */
export type MenuItemAvailability = "available" | "unavailable";

export function menuItemAvailability(item: Pick<MenuItem, "active">): MenuItemAvailability {
  return item.active ? "available" : "unavailable";
}

/**
 * Does this visible set have anything to SAY about availability?
 *
 * <p>Decided for the whole set rather than per tile, for the same reason `MenuGrid` decides the
 * photo slot that way: a per-item decision produces a ragged grid — tall tiles beside short ones,
 * row height set by whichever dish happened to be unavailable — and a ragged grid is one a thumb
 * misses. Uniform means the target is where the cashier aimed.
 *
 * <p>And when everything is available, no tile spends a row saying so forty-four times. A channel
 * that only ever carries one value is not information; it is furniture.
 */
export function setHasAvailabilitySignal(items: ReadonlyArray<Pick<MenuItem, "active">>): boolean {
  return items.some((item) => menuItemAvailability(item) === "unavailable");
}
