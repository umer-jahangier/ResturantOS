import Color from "colorjs.io";

import { wcagContrastCheck } from "./wcag-validator";

export type PaletteScale = Record<
  50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950,
  string
>;

export interface ThemePalette {
  primary: PaletteScale;
  foreground: string;
  background: string;
  contrastValid: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toOklchString(l: number, c: number, h: number): string {
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)})`;
}

/**
 * Generates an 11-stop OKLCH colour scale from a single brand hex value.
 *
 * Algorithm:
 * - Parses the hex into OKLCH colour space (L=lightness 0–1, C=chroma 0–0.4, H=hue 0–360).
 * - Derives 11 stops (50–950) by varying L and C while preserving the brand hue.
 * - L is fixed per stop for lighter values (50–400) and scaled from the base for darker (500–950).
 * - C scales proportionally to L adjustments to maintain perceptual saturation.
 * - Validates generated palette foreground against WCAG AA (≥4.5:1) using colorjs.io.
 *
 * Pure function — no side effects.
 */
export function generatePalette(primaryHex: string): ThemePalette {
  const base = new Color(primaryHex).to("oklch");

  const baseL = base.l ?? 0.5;
  const baseC = base.c ?? 0;
  const baseH = base.h ?? 0;

  type StopDef = [keyof PaletteScale, number, number];
  const stopDefs: StopDef[] = [
    [50, 0.97, baseC * 0.1],
    [100, 0.93, baseC * 0.2],
    [200, 0.87, baseC * 0.4],
    [300, 0.78, baseC * 0.6],
    [400, 0.68, baseC * 0.8],
    [500, baseL, baseC],
    [600, baseL * 0.85, baseC],
    [700, baseL * 0.7, baseC * 0.9],
    [800, baseL * 0.55, baseC * 0.8],
    [900, baseL * 0.4, baseC * 0.7],
    [950, baseL * 0.25, baseC * 0.6],
  ];

  const primary = {} as PaletteScale;
  for (const [key, l, c] of stopDefs) {
    const clampedL = clamp(l, 0, 1);
    const clampedC = clamp(c, 0, 0.4);
    primary[key] = toOklchString(clampedL, clampedC, baseH);
  }

  const p500 = primary[500];
  const white = "#ffffff";
  const black = "#000000";

  const whiteContrast = wcagContrastCheck(white, p500);
  const blackContrast = wcagContrastCheck(black, p500);

  let foreground: string;
  if (whiteContrast.passAA) {
    foreground = white;
  } else if (blackContrast.passAA) {
    foreground = black;
  } else {
    foreground = whiteContrast.ratio >= blackContrast.ratio ? white : black;
  }

  const contrastResult = wcagContrastCheck(foreground, p500);

  return {
    primary,
    foreground,
    background: primary[50],
    contrastValid: contrastResult.passAA,
  };
}
