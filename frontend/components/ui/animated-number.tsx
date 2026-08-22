"use client";

import * as React from "react";
import CountUp from "react-countup";

import { useReducedMotion } from "@/lib/hooks/ui/use-reduced-motion";
import { formatNumber } from "@/lib/format/locale";
import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
  className?: string;
}

/**
 * A figure that counts up **on first appearance and never again** (34-06, D-34-01/D-34-03).
 *
 * <h3>The trigger rule, stated once so it cannot drift</h3>
 *
 * Count-up fires on MOUNT. It does not fire on a refetch, a websocket push, a period change, a
 * filter change or any other value change — those render instantly.
 *
 * Phase 20's motion table already ruled that a data update does not animate, and the reason is
 * operational rather than aesthetic: a manager watching a live dashboard has figures arriving
 * every few seconds, and a number that re-animates on every arrival is a number nobody can
 * read. It is also the difference between a flourish and a distraction — the first appearance
 * of a figure is an event worth marking; its fourteenth update is not.
 *
 * <h3>Why it is keyed to mount rather than to "the value changed"</h3>
 *
 * `react-countup` re-animates whenever `end` changes, which is exactly the wrong trigger.
 * Keying to mount means the component holds the first value it was given as the animation's
 * target and then hands over to plain text; there is no comparison to get wrong, and no
 * `usePrevious` dance whose edge cases are invisible until a websocket is attached.
 *
 * <h3>Reduced motion</h3>
 *
 * Under `prefers-reduced-motion: reduce` the final value renders immediately, on first
 * appearance included. This is imperative motion — `react-countup` writes to the DOM from a
 * timer — so no stylesheet rule can reach it and the preference has to be consulted here
 * (D-34-03, and `motion-vocabulary.test.ts` asserts every JS-driven motion module imports the
 * hook). The hook resolves `true` on the server, so the conservative first paint is the static
 * one and hydration corrects *toward* motion rather than away from it.
 */
function AnimatedNumber({
  value,
  prefix,
  suffix,
  decimals = 0,
  duration = 1.5,
  className,
}: AnimatedNumberProps) {
  const reduced = useReducedMotion();

  // The value this instance mounted with. `useState` rather than a ref: the value is READ
  // during render, and a ref read during render is a lint error precisely because it is not a
  // reactive read. State's initialiser runs once, which is exactly the "frozen at mount"
  // semantics wanted here — it is what the ONE permitted animation counts up to, and every
  // later value bypasses the animation entirely.
  const [mountValue] = React.useState(value);
  const [hasAnimated, setHasAnimated] = React.useState(false);

  const animate = !reduced && !hasAnimated && value === mountValue;

  const formatted = React.useMemo(
    () =>
      `${prefix ?? ""}${formatNumber(value, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}${suffix ?? ""}`,
    [value, prefix, suffix, decimals],
  );

  if (!animate) {
    return (
      <span className={cn("tabular-nums", className)} data-animated="false">
        {formatted}
      </span>
    );
  }

  return (
    <span className={cn("tabular-nums", className)} data-animated="true">
      <CountUp
        end={mountValue}
        prefix={prefix}
        suffix={suffix}
        decimals={decimals}
        duration={duration}
        useEasing
        onEnd={() => setHasAnimated(true)}
      />
    </span>
  );
}

export { AnimatedNumber };
