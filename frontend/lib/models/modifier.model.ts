// Domain types for the modifier catalogue (S6). Money is number paisa (BIGINT on the wire).

export interface ModifierOption {
  id: string;
  groupId: string;
  name: string;
  /**
   * Signed BIGINT paisa. +15000 is "extra cheese, Rs 150"; -5000 is "no cheese, less Rs 50".
   * Rendered ONLY through the shared money formatter — never divided by 100 in a component.
   */
  priceDeltaPaisa: number;
  sortOrder: number;
  active: boolean;
}

export interface ModifierGroup {
  id: string;
  menuItemId: string;
  name: string;
  /** Forced: the line cannot be added until this group is answered. Always `minSelect >= 1`. */
  required: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  active: boolean;
  /** Live options INCLUDING retired ones — what the manage screen counts. */
  optionCount: number;
  options: ModifierOption[];
}

/**
 * How many options a cashier must pick from this group, phrased for a person.
 *
 * <p>The SAME wording the server's refusal uses ({@code ModifierSelectionResolver.expected}), so a
 * cashier who bypasses the dialog and gets a 422 reads the sentence they were already looking at.
 */
export function modifierGroupRule(group: Pick<ModifierGroup, "minSelect" | "maxSelect">): string {
  const { minSelect: min, maxSelect: max } = group;
  if (min === max) return `exactly ${min} ${min === 1 ? "option" : "options"}`;
  if (min === 0) return `up to ${max} ${max === 1 ? "option" : "options"}`;
  return `between ${min} and ${max} options`;
}
