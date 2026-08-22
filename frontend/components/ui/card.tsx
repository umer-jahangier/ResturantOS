import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Card, extended with an OPTIONAL depth variant (phase 34, D-34-06) and re-measured against the
 * demo in wave 38.
 *
 * <h3>What changed in wave 38, and why the "byte-identical" rule was allowed to end here</h3>
 *
 * <p>Phase 34 froze this file's default class list on purpose, and that was right for phase 34:
 * depth was an opt-in enrichment, so restyling every card in the product to ship it would have
 * been a screen rebuild wearing a design pass's clothes. Wave 38 is the opposite errand. The
 * product owner's verdict on the built product — "complete UI is very cheap, gives very basic
 * 3rd class VIBE" — is in large part a padding measurement: the demo pads every card at
 * <b>20px</b> (`.card`, `DEMO-COMPONENTS.md:373`) and 16px for its compact rung, and this file
 * shipped 16px and 12px. Four pixels of ground on each edge of thirty-four cards is not a detail
 * a screen plan can pay off one screen at a time; it is the primitive's number, and it is fixed
 * here once.
 *
 * <p>Three things moved, all of them one line:
 * <ol>
 * <li><b>`--card-spacing` 16px → 20px</b> (and the `sm` rung 12px → 16px). This is padding AND
 *     the flex gap between header/content/footer, so the card breathes in both axes.</li>
 * <li><b>Type roles instead of Tailwind sizes.</b> `text-sm` → `text-small`, `text-base` →
 *     `text-h2`. The rendered sizes barely move (14→13px body, 16→16px title); the point is that
 *     the four G1 violations this file carried are gone, so the ratchet in
 *     `__tests__/lib/theme/conformance.test.ts` tightens by four instead of fencing them
 *     forever. The 13px body is also the demo's own density decision — its body default is one
 *     full step BELOW its root size (`DEMO-TOKENS.md` §2b).</li>
 * <li><b>{@link CardEyebrow}</b>, below — the uppercase section header the demo puts on 32 of its
 *     34 cards and this product had nowhere to put.</li>
 * </ol>
 *
 * <p>`ring-1 ring-foreground/10` is deliberately NOT converted to `border`. The demo's hairline
 * is a 1px border, but a ring occupies no layout box: swapping it would grow every card's outer
 * size by 2px in each axis and reflow sixteen screens' grids for a visual difference measured at
 * ~0.2:1 of contrast. The hairline is already there; only its implementation differs.
 *
 * @param depth      layered shadow level. Omitted = today's rendering, untouched.
 * @param interactive adds the hover lift; translates only in the expressive zone.
 */
function Card({
  className,
  size = "default",
  depth,
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm";
  depth?: 1 | 2 | 3;
  interactive?: boolean;
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-depth={depth}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-small text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(5)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        depth === 1 && "shadow-depth-1",
        depth === 2 && "shadow-depth-2",
        depth === 3 && "shadow-depth-3",
        interactive && "vdl-lift",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-h2 leading-snug font-medium group-data-[size=sm]/card:text-body",
        className,
      )}
      {...props}
    />
  );
}

/**
 * `CardEyebrow` — the demo's `.card-title`, which is not a title at all but a SECTION HEADER.
 *
 * <h3>The device this product was missing</h3>
 *
 * <p>The demo puts one of these on 32 of its 34 cards — "RECENT TRANSACTIONS", "P&L SUMMARY —
 * APRIL 2025", "LIVE OPERATIONS", "TOP MENU ITEMS TODAY" — at 12px/600, uppercase, 0.08em
 * tracking, in `--text-2` (`DEMO-COMPONENTS.md:377`). We render sentence-case headings instead,
 * and that single substitution is a large share of the difference between "organised and
 * expensive" and "a div with a heading in it": small-caps at wide tracking reads as a LABEL for
 * the region below it, where a 16px sentence-case line reads as a sentence that happens to be
 * bold.
 *
 * <h3>Why a separate component rather than a variant of {@link CardTitle}</h3>
 *
 * <p>They are different jobs and they compose. `CardTitle` is the card's name — a heading, and
 * on a detail card it may legitimately be the page's most important line. `CardEyebrow` is the
 * name of a REGION, and a card can carry several (a P&L card with "REVENUE" and "COSTS" strips
 * under one title). Folding the eyebrow into `CardTitle` as a boolean would make the second case
 * impossible to express and would put a heading role on something that is not a heading.
 *
 * <p>It is a plain `<div>` for the same reason: it carries no heading level. A caller that needs
 * one passes `asChild`-style markup through `className` on an `<h2>` of their own — but the
 * default must not silently inject an `<h2>` into a document outline it cannot see.
 *
 * <h3>Sizing</h3>
 *
 * <p>`text-label` is 11px, not the demo's 12px — the type contract has roles at 11 and 13 and
 * nothing between (`globals.css` `--text-label` / `--text-small`), and reaching for `text-xs`
 * here to hit 12 is exactly the G1 violation the ratchet exists to stop. 11px uppercase at 600
 * with 0.08em tracking is the same device; the missing pixel is not the thing the product owner
 * is seeing. A `--text-eyebrow: 12px` role would close it and has been reported upward.
 */
function CardEyebrow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-eyebrow"
      className={cn(
        "text-label font-semibold tracking-[0.08em] text-foreground-secondary uppercase",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-small text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardEyebrow,
  CardAction,
  CardDescription,
  CardContent,
};
