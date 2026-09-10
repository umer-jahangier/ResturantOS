import { cn } from "@/lib/utils";

/**
 * THE ACTIVE RAIL — the demo's highest-value single device (`NEXUS_ERP_Demo.html:119-124`).
 *
 * <pre>
 * .nav-item.active::before {
 *   content:''; position:absolute; left:0; top:4px; bottom:4px;
 *   width:3px; border-radius:0 3px 3px 0;
 *   background: var(--primary); box-shadow: 0 0 8px var(--primary);
 * }
 * </pre>
 *
 * <h3>Why it lives in its own module</h3>
 *
 * It was declared inside `components/shared/sidebar.tsx` and used only there. The SuperAdmin
 * console needs the identical device — the two shells must read as one product — and importing it
 * from the tenant sidebar would drag `BranchSwitcher`, `useNavGroupVisibility`, `useTenantBrand`
 * and the tenant tooltip tree into the platform bundle to obtain eleven Tailwind classes. Moving
 * it here keeps ONE implementation (which is the point — a second hand-rolled 3px bar would drift
 * from this one on the first theme change) at no bundle cost to either shell.
 *
 * <p>`components/shared/mobile-bottom-nav.tsx` renders the same device inline on a horizontal
 * edge, and its comment points at "sidebar.tsx's ActiveRail docblock" — which is this text; it
 * simply moved one file sideways.
 *
 * <h3>Reconciling this with D-38-13, which REJECTED the gold glow</h3>
 *
 * `globals.css` carries a long block titled *"THE GOLD GLOW IS REJECTED. There is no --glow-*
 * token"*. That block stands, and this does not contradict it — read what it actually refuses,
 * in its own three numbered reasons:
 *
 * <ol>
 *   <li><b>"a FOURTH depth treatment"</b> — it refuses a chromatic <i>shadow token</i> sitting
 *       beside `--elev-*` and `--depth-*`, tinting the surface beneath an elevated panel. This
 *       adds no token: `motion-vocabulary.test.ts` scans `--(elev|depth|shadow)-*` declarations
 *       in the stylesheet and there is still nothing there for it to find. A 3px bar is not a
 *       surface and nothing sits under it.</li>
 *   <li><b>"hover-only on a surface with no hover"</b> — the refused glow was `.btn-primary:hover`
 *       and `.pay-btn.cash:hover`, i.e. an affordance a touchscreen never delivers. This is a
 *       RESTING STATE of the current route. It is present for a mouse, a finger, a keyboard and
 *       a screen reader alike, and it duplicates `aria-current="page"`, which is the channel that
 *       actually carries the meaning.</li>
 *   <li><b>"POS and KDS are operational: a glow is decoration"</b> — the operator shell removes
 *       the tenant sidebar from the DOM on `/app/pos/**` (`app/(tenant)/layout.tsx` returns early
 *       on `isOperatorRoute`), so no rail, glowing or otherwise, is reachable from a terminal, and
 *       the platform console is not reachable from one at all. It is also static: no animation, no
 *       transform, no filter, no containing block — so it is invisible to
 *       `zone-containment.test.ts`'s six creators and cannot print itself onto a receipt.</li>
 * </ol>
 *
 * <h3>Why the halo is authored per theme rather than once</h3>
 *
 * A glow is a dark-ground device. `--primary` is the TEXT role and resolves to `--primary-700`
 * (bronze, 5.86:1 on white) in light and to `--primary-400` (the demo's gold) in dark — so one
 * `box-shadow: 0 0 8px var(--primary)` would paint a brown smudge on a near-white rail and a
 * gold halo on a dark one. The BAR keeps `--primary` in both themes because that is the stop
 * that stays legible; the HALO is built from `--primary-400` in light, so the light theme gets a
 * warm gold bloom around a bronze bar instead of mud.
 */
export function ActiveRail() {
  return (
    <span
      aria-hidden="true"
      data-slot="nav-active-rail"
      className={cn(
        "pointer-events-none absolute inset-y-1 left-0 w-[3px] rounded-r-[3px] bg-primary",
        "shadow-[0_0_8px_color-mix(in_oklab,var(--primary-400)_55%,transparent)]",
        "dark:shadow-[0_0_8px_var(--primary)]",
      )}
    />
  );
}
