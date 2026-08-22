import * as React from "react";

import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardEyebrow, CardHeader } from "@/components/ui/card";

/**
 * One titled section of the tenant console.
 *
 * <h3>Why a component and not eight hand-written `<section>`s</h3>
 *
 * The tenant detail screen is eight panels written by different hands over several plans, and the
 * version this replaces proved what that costs: four of them opened with `<h2 className="text-lg
 * font-semibold">`, one with `text-2xl`, and the headings sat at three different distances from
 * their content. On a control plane that reads as carelessness, and carelessness is exactly the
 * wrong signal on the screen where a click takes a restaurant offline.
 *
 * <p>So the section shell is declared once: `Card` at depth 1, a ruled header carrying the
 * uppercase letter-spaced eyebrow the tenant app uses for every card header, and the 20px internal
 * padding `--card-spacing` already encodes.
 *
 * <h3>The heading is a real `<h2>`, deliberately</h3>
 *
 * `CardTitle` renders a `<div>` — correct for a card whose title is a label, wrong for a page whose
 * sections a screen-reader user navigates by heading. The eight panels of this console ARE the
 * document outline: an operator asking "where is the impersonation history" should be able to reach
 * it with one keystroke rather than by reading the whole page. The classes are `CardTitle`'s
 * verbatim so the two render identically; only the element differs.
 *
 * <p>`anchorId` doubles as the fragment target for the in-page rail at the top of the screen, which
 * is why `scroll-mt` is set here rather than at the call site — a section that scrolls under a
 * sticky header is a link that appears not to work.
 */
export interface ConsoleSectionProps {
  /** Fragment id AND `aria-labelledby` anchor. Stable — the section rail links to it. */
  anchorId: string;
  /** The eyebrow: what KIND of thing this is, in the console's small-caps voice. */
  eyebrow: string;
  /** The section heading, sentence case. */
  title: string;
  /** One line on what an operator is looking at, or what it will not tell them. */
  description?: React.ReactNode;
  /** Controls that belong to the section as a whole, aligned to the header's trailing edge. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function ConsoleSection({
  anchorId,
  eyebrow,
  title,
  description,
  action,
  children,
  className,
  "data-testid": testId,
}: ConsoleSectionProps) {
  const headingId = `${anchorId}-heading`;
  return (
    // The landmark wraps the Card rather than being it: `Card` is a `<div>` with no element
    // escape hatch, and reaching for one would mean widening a primitive four other modules use
    // so this screen could have a `<section>`. The outer element carries the fragment target.
    <section
      id={anchorId}
      aria-labelledby={headingId}
      className={cn("scroll-mt-20", className)}
      data-testid={testId}
    >
      <Card depth={1}>
        <CardHeader className="border-b">
          <CardEyebrow className="tracking-eyebrow">{eyebrow}</CardEyebrow>
          <h2 id={headingId} className="font-heading text-h2 leading-snug font-medium">
            {title}
          </h2>
          {description ? <p className="text-small text-muted-foreground">{description}</p> : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

/**
 * A labelled fact. The console's `<dl>` cell, and the reason `—` never appears bare.
 *
 * <p>`value` is a `ReactNode` so a caller can pass a chip, a `MoneyDisplay` or a mono identifier;
 * `absence` is the string to render when there is nothing, and it is REQUIRED to be words rather
 * than punctuation. "Not set" and "Never" and "Not recorded" are three different facts, and a
 * console that renders all three as an em dash has told the operator nothing three times.
 */
export function ConsoleFact({
  label,
  value,
  absence,
  mono = false,
  className,
}: {
  label: string;
  value?: React.ReactNode;
  absence?: string;
  mono?: boolean;
  className?: string;
}) {
  const empty = value === undefined || value === null || value === "";
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-small",
          empty ? "text-foreground-tertiary" : "font-medium text-foreground",
          mono && !empty && "font-mono tabular-nums",
        )}
      >
        {empty ? (absence ?? "Not recorded") : value}
      </dd>
    </div>
  );
}

/**
 * A stated absence, ruled off.
 *
 * The dashed hairline is `Meter`'s and `StatTile`'s established rendering for "there is no honest
 * reading here", reused so an absence looks ISSUED rather than broken. Every screen in this console
 * has at least one, because most of what a control plane would like to show about a tenant is not
 * measured by this product — and saying so in a deliberate box is the difference between an honest
 * console and one that looks half-built.
 */
export function ConsoleNote({
  children,
  tone = "neutral",
  className,
  ...rest
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning";
  className?: string;
  "data-testid"?: string;
  role?: string;
}) {
  return (
    <p
      className={cn(
        "rounded-lg border border-dashed p-(--space-md) text-small",
        tone === "warning"
          ? "border-warning/40 bg-warning/5 text-foreground"
          : "border-border bg-surface-2 text-foreground-secondary",
        className,
      )}
      {...rest}
    >
      {children}
    </p>
  );
}
