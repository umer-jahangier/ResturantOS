import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The eight contract type roles, published into `@theme` by 38-01 (UI-SPEC §3).
 *
 * <p>Exported ONLY so `__tests__/lib/utils-cn.test.ts` can prove this list is exactly the set of
 * `--text-<role>` keys declared in `app/globals.css`. That tie is the point: adding a ninth role
 * to the stylesheet without registering it here would reproduce the bug below for the new role
 * alone — silently, on whatever screens adopted it first. Nothing else should import this.
 */
export const TYPE_ROLES = ["display", "h1", "h2", "body", "small", "label", "pos", "kds"] as const;

/**
 * `cn`, taught about the contract type scale.
 *
 * <h3>The silent failure this exists to prevent</h3>
 *
 * tailwind-merge resolves conflicts by classifying each class into a group and keeping the last
 * one per group. It knows Tailwind's stock font sizes (`text-sm`, `text-2xl`) and it knows colour
 * utilities (`text-muted-foreground`) — but 38-01's roles are *custom* theme keys, so out of the
 * box `text-label` is unrecognised and falls into the **text-color** group by shape. Written
 * together, as they constantly are:
 *
 * ```tsx
 * cn("text-label uppercase", "text-foreground-secondary")
 * ```
 *
 * tailwind-merge saw two colours, kept the later one, and **silently deleted the font size**.
 * The element rendered at whatever it inherited. Nothing errored; the class simply was not there.
 *
 * Caught by `data-grid.test.tsx`'s "column headers use the Label type role" assertion, which read
 * the rendered `className` and found `text-label` missing from a string that had literally just
 * been written with it. Left unfixed, every later plan adopting `text-body` / `text-small` /
 * `text-label` through `cn()` — which is most of them — would have produced call sites that look
 * correct in source, pass review, and have no effect in the browser.
 *
 * <p>Registering the roles as font sizes makes `text-label` and `text-foreground-secondary`
 * members of *different* groups, so both survive, and a genuine size-vs-size conflict
 * (`text-body text-h1`) still collapses to the last one, which is what a caller means.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_ROLES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
