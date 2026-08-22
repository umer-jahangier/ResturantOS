import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { ZoneProvider, type Zone } from "@/components/providers/zone-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ENTRANCE_CLASS } from "@/components/ui/overlay-motion";

/**
 * D-38-04 / D-38-05 — the shared overlays spend entrance motion only where the zone allows it.
 *
 * <h3>What this asserts, and why it is asserted this way</h3>
 *
 * <p>Not "the className string contains the right substring". The assertions below run
 * `document.querySelector` with **the selector globals.css actually ships** —
 * `[data-zone="expressive"] .vdl-enter-scale` — against the real portalled DOM. That is the
 * difference between proving the class was written and proving the rule can reach the node.
 *
 * <p>It matters here more than anywhere else in the product. Radix mounts every one of these
 * overlays on `document.body`, outside every zone subtree, so a zone-scoped rule written
 * against DOM ancestry matches nothing — "present in the stylesheet and absent on the screen",
 * which is the failure the containment gate's docblock singles out as the most likely defect of
 * the whole phase. The components therefore re-publish their zone INSIDE the portal via
 * `ZoneProvider`, and this file fails if that stamp ever stops reaching the DOM.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * <ol>
 *   <li>Run first against the UNFIXED components, entrance hard-coded as `zoom-in-95` on every
 *       zone: <b>12 failed, 3 passed</b>. Every operational case red on the transform utility,
 *       every expressive case red because `vdl-enter-scale` was nowhere. The three that passed
 *       are the D-38-05 stamp assertions, which were already correct and are here as a
 *       regression guard.</li>
 *   <li>`ZoneProvider` deleted from `DialogContent`'s portal, the class left in place: <b>"an
 *       expressive dialog keeps its entrance animation" red</b> — "expected null to be
 *       &lt;div role="dialog"&gt;" — while the `classList.contains` assertion two lines above it
 *       stayed green. That is the whole reason this file queries by selector: a class that is
 *       written, looks correct, and does nothing.</li>
 *   <li>`overlayEntranceClass` inverted to `zone !== "expressive"`: <b>10 failed</b> — all five
 *       operational cases plus all five expressive ones. Restored.</li>
 * </ol>
 */

/** The rule globals.css ships (`[data-zone="expressive"] .vdl-enter-scale`), as a selector. */
const ANIMATED = `[data-zone="expressive"] .${ENTRANCE_CLASS}`;

/**
 * The transform-carrying utilities D-38-04 forbids on an operational surface. Checked on the
 * node's own class list as well as through the cascade selector, because a zoom utility written
 * directly at the call site would never need a zone ancestor to render.
 */
const TRANSFORM_UTILITY = /\b(zoom-(in|out)|slide-(in-from|out-to))-/;

function inZone(zone: Zone, ui: React.ReactNode) {
  return render(<ZoneProvider zone={zone}>{ui}</ZoneProvider>);
}

const dialog = (
  <Dialog open>
    <DialogContent>
      <DialogTitle>Void this item?</DialogTitle>
      <DialogDescription>The line is removed from the bill.</DialogDescription>
    </DialogContent>
  </Dialog>
);

const dropdown = (
  <DropdownMenu open>
    <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem>Void</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const popover = (
  <Popover open>
    <PopoverTrigger>Open</PopoverTrigger>
    <PopoverContent>Discount</PopoverContent>
  </Popover>
);

const tooltip = (
  <TooltipProvider>
    <Tooltip open>
      <TooltipTrigger>Fire</TooltipTrigger>
      <TooltipContent>Send to kitchen</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

/**
 * A submenu, which is the one surface here that gets NO `ZoneProvider` of its own: Radix mounts
 * sub-content in place rather than through a second portal, so it inherits the parent menu's
 * stamp. That is a claim about someone else's rendering, so it is measured, not assumed — if a
 * future Radix version portals sub-content to the body, the expressive case below goes red.
 */
const submenu = (
  <DropdownMenu open>
    <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuSub open>
        <DropdownMenuSubTrigger>Move to…</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem>Table 4</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu>
);

const SURFACES: [name: string, slot: string, ui: React.ReactNode][] = [
  ["dialog", '[data-slot="dialog-content"]', dialog],
  ["dropdown menu", '[data-slot="dropdown-menu-content"]', dropdown],
  ["submenu", '[data-slot="dropdown-menu-sub-content"]', submenu],
  ["popover", '[data-slot="popover-content"]', popover],
  ["tooltip", '[data-slot="tooltip-content"]', tooltip],
];

describe("D-38-04 · shared overlays carry no entrance motion on an operational surface", () => {
  it.each(SURFACES)("an operational %s renders no entrance animation", (_name, slot, ui) => {
    inZone("operational", ui);

    const content = document.querySelector(slot);
    expect(content, `${slot} did not render — the assertion below would pass vacuously`).not.toBe(
      null,
    );

    expect(
      content!.className,
      "a transform-carrying entrance utility on the POS/KDS is a D-38-04 violation, and on the " +
        "receipt route it is also a containing block for `.receipt-root`",
    ).not.toMatch(TRANSFORM_UTILITY);
    expect(content!.classList.contains(ENTRANCE_CLASS)).toBe(false);
    expect(document.querySelector(ANIMATED)).toBe(null);
  });

  it.each(SURFACES)("an expressive %s keeps its entrance animation", (_name, slot, ui) => {
    inZone("expressive", ui);

    const content = document.querySelector(slot);
    expect(content).not.toBe(null);
    expect(content!.classList.contains(ENTRANCE_CLASS)).toBe(true);

    // The whole point: the class is only half of it. This is the globals.css selector run
    // against the portalled node, so it fails if the zone stamp does not reach the DOM.
    expect(
      document.querySelector(`${ANIMATED}${slot}`),
      'the entrance class is present but no [data-zone="expressive"] ancestor reaches it — ' +
        "the rule is in the stylesheet and matches nothing",
    ).toBe(content);
  });

  it.each(SURFACES)("a restrained %s renders the content, unanimated", (_name, slot, ui) => {
    // Restrained is not a third animation; it is the absence of one. UI-SPEC §5: elevation and
    // ≤150ms transitions, no decorative motion. The class is still applied (D-38-04 gates only
    // the operational zone) and the cascade, which scopes the rule to expressive, declines it.
    inZone("restrained", ui);

    const content = document.querySelector(slot);
    expect(content).not.toBe(null);
    expect(content!.className).not.toMatch(TRANSFORM_UTILITY);
    expect(document.querySelector(ANIMATED)).toBe(null);
  });
});

describe("D-38-05 · a modal inherits the zone that opened it", () => {
  it("the dialog overlay stamps the OPENING surface's zone, not a hard-coded one", () => {
    inZone("operational", dialog);
    expect(document.querySelector('[data-slot="dialog-overlay"]')?.getAttribute("data-zone")).toBe(
      "operational",
    );
  });

  it("the same component stamps expressive when opened from an expressive surface", () => {
    inZone("expressive", dialog);
    expect(document.querySelector('[data-slot="dialog-overlay"]')?.getAttribute("data-zone")).toBe(
      "expressive",
    );
  });

  it("an overlay outside any declared zone falls back to restrained, never to expressive", () => {
    // The safe default in both directions (zone-provider.tsx). An overlay that forgot to declare
    // itself must not be the one route by which glass and motion reach a terminal.
    render(dialog);
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay?.getAttribute("data-zone")).toBe("restrained");
    expect(document.querySelector(ANIMATED)).toBe(null);
  });

  it("the zone wrapper does not keep a closed dialog mounted", () => {
    /*
     * The cost of the wrapper, paid up front. `DialogPortal` maps EACH child through its own
     * `Presence`, so the zone wrapper — not the content — is now what the outer presence
     * watches. A wrapper that held the tree open would leave a closed modal on top of the POS,
     * blocking every tap underneath it, and no zone assertion in this file would notice.
     *
     * It cannot: the wrapper is `display: contents` and carries no animation, so presence
     * releases it on the same tick. The dialog surface itself carries no exit animation either.
     */
    const { rerender } = render(
      <ZoneProvider zone="expressive">
        <Dialog open>
          <DialogContent>
            <DialogTitle>Void this item?</DialogTitle>
            <DialogDescription>The line is removed from the bill.</DialogDescription>
          </DialogContent>
        </Dialog>
      </ZoneProvider>,
    );
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBe(null);

    rerender(
      <ZoneProvider zone="expressive">
        <Dialog open={false}>
          <DialogContent>
            <DialogTitle>Void this item?</DialogTitle>
            <DialogDescription>The line is removed from the bill.</DialogDescription>
          </DialogContent>
        </Dialog>
      </ZoneProvider>,
    );
    expect(document.querySelector('[data-slot="dialog-content"]')).toBe(null);
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBe(null);
  });
});
