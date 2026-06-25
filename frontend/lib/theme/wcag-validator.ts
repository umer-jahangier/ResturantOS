import Color from "colorjs.io";

export interface ContrastResult {
  ratio: number;
  passAA: boolean;
  passAALarge: boolean;
}

function relativeLuminance(color: Color): number {
  const srgb = color.to("srgb");
  const channels = [srgb.r ?? 0, srgb.g ?? 0, srgb.b ?? 0].map((c) => {
    const clamped = Math.max(0, Math.min(1, c));
    return clamped <= 0.04045
      ? clamped / 12.92
      : Math.pow((clamped + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/**
 * Computes the WCAG 2.1 contrast ratio between two colours expressed as
 * CSS-parseable strings (hex, oklch(...), hsl(...), etc.).
 * Passes through colorjs.io for accurate gamut-aware conversion.
 */
export function wcagContrastCheck(fg: string, bg: string): ContrastResult {
  const fgColor = new Color(fg);
  const bgColor = new Color(bg);

  const l1 = relativeLuminance(fgColor);
  const l2 = relativeLuminance(bgColor);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return {
    ratio: Math.round(ratio * 100) / 100,
    passAA: ratio >= 4.5,
    passAALarge: ratio >= 3.0,
  };
}

/**
 * Convenience validator for tenant colour pairs.
 * Returns `true` when the primary/foreground pair meets WCAG AA for normal text (≥4.5:1).
 * Used by Settings → Appearance (plan 04-08) to reject failing colour combos.
 */
export function validateTenantColours(
  primaryHex: string,
  fgHex: string,
): boolean {
  try {
    const result = wcagContrastCheck(primaryHex, fgHex);
    return result.passAA;
  } catch {
    return false;
  }
}
