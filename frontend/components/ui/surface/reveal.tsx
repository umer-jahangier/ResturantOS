"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useZone } from "@/components/providers/zone-provider";

export interface RevealProps extends React.ComponentProps<"div"> {
  /**
   * Stagger index. Sets `--vdl-i`, which the `.vdl-stagger` rule multiplies by
   * `--motion-stagger` — so adding a sixth item does not mean rewriting five delays.
   */
  index?: number;
  /** `rise` fades and lifts; `scale` fades and grows from 0.97. */
  variant?: "rise" | "scale";
}

/**
 * Wraps content in an entrance animation — and, crucially, is a NO-OP that still renders its
 * children correctly when the animation cannot or should not run.
 *
 * <h3>The resting-state contract, in component form</h3>
 *
 * This adds a class and a custom property. It sets no opacity, no transform, no visibility.
 * Strip the class and the children are exactly where they belong, at full opacity.
 *
 * That is the whole design. The intuitive alternative — render hidden, animate to visible —
 * produces a blank screen for a reduced-motion user, for a backgrounded tab, and for anyone
 * whose animation simply did not run. It reads as a data-loading bug rather than a motion bug,
 * which is why it survives review, and it is why
 * `__tests__/lib/motion/motion-vocabulary.test.ts` asserts the property structurally.
 *
 * <p>Outside the expressive zone this renders a plain wrapper. The entrance duration is 420ms,
 * above phase 20's 240ms ceiling, and that ceiling still binds on restrained and operational
 * surfaces (D-34-02).
 */
export function Reveal({ index, variant = "rise", className, style, ...props }: RevealProps) {
  const zone = useZone();

  if (zone !== "expressive") {
    // Not "a shorter animation" — none. A restrained list and an operational terminal get the
    // content, immediately, with no entrance at all.
    return <div className={className} style={style} {...props} />;
  }

  return (
    <div
      data-slot="reveal"
      className={cn(variant === "scale" ? "vdl-enter-scale" : "vdl-enter", className)}
      style={index === undefined ? style : { ...style, ["--vdl-i" as string]: String(index) }}
      {...props}
    />
  );
}

export interface RevealGroupProps extends React.ComponentProps<"div"> {
  /** Renders children in sequence, each offset by one `--motion-stagger` interval. */
  stagger?: boolean;
}

/**
 * Sequences its direct children. The delay is computed by the stylesheet from each child's
 * `--vdl-i`, so the rhythm stays correct as items are added or removed — a hand-written delay
 * per child drifts the moment the list changes length.
 */
export function RevealGroup({ stagger = true, className, children, ...props }: RevealGroupProps) {
  const zone = useZone();
  const expressive = zone === "expressive";

  return (
    <div
      data-slot="reveal-group"
      className={cn(expressive && stagger && "vdl-stagger", className)}
      {...props}
    >
      {expressive && stagger
        ? React.Children.map(children, (child, i) =>
            React.isValidElement(child)
              ? React.cloneElement(child as React.ReactElement<{ style?: React.CSSProperties }>, {
                  style: {
                    ...((child as React.ReactElement<{ style?: React.CSSProperties }>).props
                      .style ?? {}),
                    ["--vdl-i" as string]: String(i),
                  },
                })
              : child,
          )
        : children}
    </div>
  );
}
