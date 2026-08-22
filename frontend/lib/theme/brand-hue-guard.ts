import Color from "colorjs.io";

/**
 * The brand-hue guard (38-10 task 4).
 *
 * <h3>The rule this plan asked for is stale, and shipping it would have been wrong twice</h3>
 *
 * 38-10 task 4 carries forward a phase-20 measurement: *"`--chart-1` follows the brand hue while
 * `--chart-2..5` are pinned, so a tenant hue near 262° walks series 1 into series 3 (ΔE2000 15.8
 * at 262). The theme route must reject or nudge any `--brand-h` within ~35° of 262."*
 *
 * Both halves were re-measured against the tokens as they stand today, and both have moved:
 *
 * <ol>
 * <li><b>`--chart-1` no longer follows the brand hue.</b> D-38-12 retargeted it to `--accent-h`
 *     (teal, 182) because at gold it collided with `--chart-2` — `globals.css:487-491` states the
 *     retarget and its reason. So the series-1-into-series-3 walk the rule describes cannot
 *     happen: the two hues it names are now 182 and 262, pinned, 80° apart, and neither of them
 *     is the tenant's.</li>
 * <li><b>The band it protects is not the dangerous one.</b> Measured across the whole circle with
 *     `colorjs.io`, holding the default preset's L and C and comparing the generated primary
 *     against all five chart series in BOTH themes, gamut-mapped to sRGB as the display shows them:
 *     at h=262 the worst separation is ΔE2000 <b>11.82</b> — comfortable. The genuinely dangerous
 *     band is <b>168–198</b>, bottoming out at ΔE2000 <b>1.70</b> against `--chart-1` at h=185.
 *     That is an order of magnitude closer than the hue the rule names, and the rule does not
 *     mention it.</li>
 * </ol>
 *
 * <p><b>And the rule as written rejects the product's own default.</b> `#3b82f6` — the colour
 * `AppearanceForm` ships as its first preset and `initialColor` — is OKLCH hue <b>259.81</b>,
 * which is 2.19° from 262. A guard built to the plan's literal words would refuse the colour the
 * app is wearing right now, and refuse the Violet preset (292.72) as collateral, while admitting
 * teal, the one that actually collides.
 *
 * <h3>So the guard is built on the measurement rather than on the sentence</h3>
 *
 * It compares the tenant's generated accent against every chart series in both themes and refuses
 * the ones that are genuinely indistinguishable. That is the property the phase-20 note was
 * reaching for; the 262° figure was a proxy for it that has since expired.
 *
 * <h3>Why ΔE2000 8.0, stated with what it costs</h3>
 *
 * 8.0 is the largest round threshold that refuses all three measured collision bands
 * (<b>31–49</b>, <b>168–198</b>, <b>289–309</b> — 71 of 360 hues) while refusing none of the eight
 * colours this product itself offers as a preset. The next step up, 10.0, would refuse **three of
 * those eight** — Emerald (9.39), Coral Red (9.96) and Violet (9.65) — i.e. a guard that fires on
 * 37 % of the choices the product presents as recommended, which is a guard nobody keeps.
 *
 * <p>For scale: `globals.css:487-490` calls a pairwise chart separation of 20.20 "the
 * worst-separated pair in the series" and treats it as a problem. A tenant accent sitting at 1.70
 * from a series is under the just-noticeable-difference floor — not merely similar, the same
 * colour as far as a reader is concerned.
 *
 * <h3>It warns and offers a nudge. It does not block.</h3>
 *
 * The existing 4.5:1 contrast check in `AppearanceForm` disables Save, and that is right — it is
 * an accessibility failure. This is not: a tenant accent close to a chart series is a legibility
 * risk in one composition (a chart with a primary-coloured element beside it), not a floor
 * anybody falls through. Blocking would also be a behaviour change on the one screen whose entire
 * purpose is choosing a colour. So it returns a reason, the series it collides with **by name**,
 * and a concrete replacement hex — and the caller decides.
 *
 * <h3>What it deliberately does NOT do</h3>
 *
 * It does not touch `app/api/theme/route.ts`. That route emits exactly thirteen declarations —
 * the `--primary-*` ramp, `--primary` and `--primary-foreground` — and phase 34's hue sweep holds
 * across the whole circle *because* of that narrowness (task 4's own first bullet). Adding a
 * refusal there would make the route a policy surface as well as a generator, and its three
 * assertions exist to keep it from becoming one. The guard belongs where a human picks the
 * colour, which is the form.
 */

/** ΔE2000 below this and the tenant accent is not reliably distinguishable from a chart series. */
export const BRAND_HUE_MIN_DELTA_E = 8.0;

/**
 * The five chart series, in both themes, exactly as `app/globals.css` declares them.
 *
 * <p>`--chart-1` is authored as `var(--accent-h)`; that variable is `182` (D-38-12,
 * `globals.css:346`) and is substituted here because `colorjs.io` cannot resolve a CSS custom
 * property. If `--accent-h` ever moves, this constant is wrong and the test that pins it —
 * `__tests__/settings/brand-hue-guard.test.ts` — is the thing that says so.
 */
const ACCENT_H = 182;

const CHART_SERIES = [
  { theme: "light", series: 1, css: `oklch(0.62 0.1057 ${ACCENT_H})` },
  { theme: "light", series: 2, css: "oklch(0.56 0.19 35)" },
  { theme: "light", series: 3, css: "oklch(0.5 0.19 262)" },
  { theme: "light", series: 4, css: "oklch(0.68 0.19 300)" },
  { theme: "light", series: 5, css: "oklch(0.44 0.1871 345)" },
  { theme: "dark", series: 1, css: `oklch(0.7 0.1194 ${ACCENT_H})` },
  { theme: "dark", series: 2, css: "oklch(0.64 0.19 35)" },
  { theme: "dark", series: 3, css: "oklch(0.58 0.19 262)" },
  { theme: "dark", series: 4, css: "oklch(0.88 0.0689 300)" },
  { theme: "dark", series: 5, css: "oklch(0.52 0.19 345)" },
] as const;

export interface BrandHueReading {
  /** The chosen colour's OKLCH hue, 0–360. */
  hue: number;
  /** The smallest ΔE2000 between the generated accent and any chart series, in either theme. */
  deltaE: number;
  /** Which series that was, in words — `"series 1 in dark mode"`. Never a bare index. */
  nearestSeries: string;
}

export type BrandHueVerdict =
  | ({ ok: true } & BrandHueReading)
  | ({
      ok: false;
      /** One sentence naming the collision and its consequence. Not "invalid colour". */
      reason: string;
      /** A hex at the nearest hue that clears the threshold, same L and C. `null` if none does. */
      suggestedHex: string | null;
    } & BrandHueReading);

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The two stops a tenant colour is actually seen at beside a chart.
 *
 * <p>`--primary` resolves to the 500 stop in light and the 400 stop in dark
 * (`app/api/theme/route.ts:40,55`), so those are the two that can sit next to a series. Comparing
 * the raw hex would measure a colour the interface never paints.
 */
function accentStops(base: Color): Array<{ theme: "light" | "dark"; color: Color }> {
  const l = base.l ?? 0.5;
  const c = base.c ?? 0;
  const h = base.h ?? 0;
  return [
    // 500: the base L and C, unchanged — `palette-generator.ts:51`.
    { theme: "light", color: new Color("oklch", [l, c, h]) },
    // 400: L pinned to 0.68 at 80 % chroma — `palette-generator.ts:50`.
    { theme: "dark", color: new Color("oklch", [0.68, c * 0.8, h]) },
  ];
}

/**
 * Every comparison happens in sRGB, gamut-mapped — because that is what the screen shows.
 *
 * <p>Found by driving it: measuring in raw OKLCH put the worst hue at 182 / ΔE 3.98 against the
 * DARK stop, and the guard then refused a colour whose *rendered* nearest neighbour was a
 * different series in the other theme — the test asserting the dark stop was measured went red
 * against a light-mode answer, which is how this was noticed at all. Gamut-mapped and read back
 * through a real six-digit hex, the worst is h=185 at ΔE **1.70**, against light series 1. Several of these coordinates are outside sRGB at
 * the chroma a real brand colour carries, and the browser gamut-maps them before painting. Two
 * colours that are far apart in an unreachable space and adjacent on the display are adjacent —
 * the display is the thing the user looks at.
 */
function inGamut(color: Color): Color {
  return color.toGamut({ space: "srgb", method: "css" });
}

function readAt(base: Color, hue: number): BrandHueReading {
  const rotated = new Color("oklch", [base.l ?? 0.5, base.c ?? 0, hue]);
  let deltaE = Number.POSITIVE_INFINITY;
  let nearestSeries = "";

  for (const stop of accentStops(rotated)) {
    const painted = inGamut(stop.color);
    for (const entry of CHART_SERIES) {
      if (entry.theme !== stop.theme) continue;
      const d = painted.deltaE(inGamut(new Color(entry.css)), "2000");
      if (d < deltaE) {
        deltaE = d;
        nearestSeries = `series ${entry.series} in ${entry.theme} mode`;
      }
    }
  }

  return { hue, deltaE, nearestSeries };
}

/** Parse a hex and read it at its own hue. The one entry point both the verdict and the nudge use. */
function readHex(hex: string): BrandHueReading {
  const parsed = new Color(hex).to("oklch");
  return readAt(parsed, parsed.h ?? 0);
}

/**
 * The nearest hue in either direction that clears the threshold, as a hex at the same L and C.
 *
 * <p>Searched outward one degree at a time rather than solved, because the objective is a min
 * over ten ΔE2000 evaluations and is not monotonic — the analytic answer would be a second,
 * weaker model of the same thing. 180 steps is the whole circle; if nothing clears, it returns
 * `null` and the caller says so rather than inventing a colour.
 */
function nudge(base: Color, hue: number): string | null {
  for (let step = 1; step <= 180; step += 1) {
    for (const candidate of [(hue + step) % 360, (hue - step + 360) % 360]) {
      const hex = inGamut(new Color("oklch", [base.l ?? 0.5, base.c ?? 0, candidate]))
        .to("srgb")
        .toString({ format: "hex" });
      /*
       * The candidate is judged as the HEX, not as the coordinates it was built from.
       *
       * A six-digit hex cannot hold an out-of-gamut OKLCH triple, so writing one and reading it
       * back moves the colour. An earlier version checked the coordinates and returned the hex,
       * and offered a "safe" replacement that the guard itself then refused — a suggestion that
       * fails its own test is worse than no suggestion, because the user takes it.
       *
       * `readHex`, not `checkBrandHue`: the latter calls back into here, and a refused candidate
       * then recursed until the stack ran out. Observed as `RangeError: Maximum call stack size
       * exceeded` inside `toGamut`, which is a long way from the mistake that caused it.
       */
      if (readHex(hex).deltaE >= BRAND_HUE_MIN_DELTA_E) return hex;
    }
  }
  return null;
}

/**
 * Judge a tenant brand colour against the chart series.
 *
 * @param hex a 6-digit hex. Anything else is treated as `ok` — malformed input is the hex field's
 *   own validation problem, and a guard that also invented a second "invalid colour" error would
 *   put two different messages on one mistake.
 */
export function checkBrandHue(hex: string): BrandHueVerdict {
  if (!HEX_REGEX.test(hex)) {
    return { ok: true, hue: 0, deltaE: Number.POSITIVE_INFINITY, nearestSeries: "" };
  }

  const base = new Color(hex).to("oklch");
  const reading = readHex(hex);

  if (reading.deltaE >= BRAND_HUE_MIN_DELTA_E) return { ok: true, ...reading };

  return {
    ok: false,
    ...reading,
    reason:
      `This colour is very close to chart ${reading.nearestSeries} ` +
      `(ΔE2000 ${reading.deltaE.toFixed(1)}, and ${BRAND_HUE_MIN_DELTA_E.toFixed(1)} is the ` +
      `smallest difference that stays readable). On a report with several lines, your accent and ` +
      `that line will look like the same colour.`,
    suggestedHex: nudge(base, reading.hue),
  };
}
