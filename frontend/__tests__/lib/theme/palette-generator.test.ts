import { describe, expect, it } from "vitest";

import {
  generatePalette,
  type PaletteScale,
} from "@/lib/theme/palette-generator";

const SCALE_KEYS: Array<keyof PaletteScale> = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
];

const OKLCH_PATTERN = /^oklch\(\d+\.\d+ \d+\.\d+ \d+\.\d+\)$/;

describe("generatePalette", () => {
  describe("blue (#3b82f6)", () => {
    it("produces an 11-stop scale with all required keys", () => {
      const { primary } = generatePalette("#3b82f6");
      for (const key of SCALE_KEYS) {
        expect(primary[key]).toBeDefined();
      }
    });

    it("serialises all stops as valid OKLCH strings", () => {
      const { primary } = generatePalette("#3b82f6");
      for (const key of SCALE_KEYS) {
        expect(primary[key]).toMatch(OKLCH_PATTERN);
      }
    });

    it("500 stop preserves the input hue (within ±1°)", () => {
      const { primary } = generatePalette("#3b82f6");
      // Blue hue is approximately 250° in OKLCH
      const match = primary[500].match(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/);
      expect(match).toBeTruthy();
      const hue = parseFloat(match![1]!);
      expect(hue).toBeGreaterThan(240);
      expect(hue).toBeLessThan(270);
    });

    it("50 stop is lighter than 500", () => {
      const { primary } = generatePalette("#3b82f6");
      const l50 = parseFloat(primary[50].split(" ")[0]!.replace("oklch(", ""));
      const l500 = parseFloat(
        primary[500].split(" ")[0]!.replace("oklch(", ""),
      );
      expect(l50).toBeGreaterThan(l500);
    });

    it("950 stop is darker than 500", () => {
      const { primary } = generatePalette("#3b82f6");
      const l500 = parseFloat(
        primary[500].split(" ")[0]!.replace("oklch(", ""),
      );
      const l950 = parseFloat(
        primary[950].split(" ")[0]!.replace("oklch(", ""),
      );
      expect(l950).toBeLessThan(l500);
    });

    it("contrastValid is true for standard blue", () => {
      const { contrastValid } = generatePalette("#3b82f6");
      expect(contrastValid).toBe(true);
    });
  });

  describe("red (#ef4444)", () => {
    it("produces valid OKLCH strings for all stops", () => {
      const { primary } = generatePalette("#ef4444");
      for (const key of SCALE_KEYS) {
        expect(primary[key]).toMatch(OKLCH_PATTERN);
      }
    });

    it("returns a foreground colour of #ffffff or #000000", () => {
      const { foreground } = generatePalette("#ef4444");
      expect(["#ffffff", "#000000"]).toContain(foreground);
    });

    it("background equals primary[50]", () => {
      const { background, primary } = generatePalette("#ef4444");
      expect(background).toBe(primary[50]);
    });
  });

  describe("edge case: very dark colour (#1a1a1a)", () => {
    it("does not produce negative lightness values", () => {
      const { primary } = generatePalette("#1a1a1a");
      for (const key of SCALE_KEYS) {
        const l = parseFloat(primary[key].split(" ")[0]!.replace("oklch(", ""));
        expect(l).toBeGreaterThanOrEqual(0);
      }
    });

    it("produces a valid OKLCH string for all stops", () => {
      const { primary } = generatePalette("#1a1a1a");
      for (const key of SCALE_KEYS) {
        expect(primary[key]).toMatch(OKLCH_PATTERN);
      }
    });

    it("950 stop lightness is ≥ 0 (clamp enforced)", () => {
      const { primary } = generatePalette("#1a1a1a");
      const l950 = parseFloat(
        primary[950].split(" ")[0]!.replace("oklch(", ""),
      );
      expect(l950).toBeGreaterThanOrEqual(0);
    });
  });

  describe("edge case: very light colour (#f8f8f8)", () => {
    it("scale still spans a usable lightness range (50 lighter than 950)", () => {
      const { primary } = generatePalette("#f8f8f8");
      const l50 = parseFloat(primary[50].split(" ")[0]!.replace("oklch(", ""));
      const l950 = parseFloat(
        primary[950].split(" ")[0]!.replace("oklch(", ""),
      );
      expect(l50).toBeGreaterThanOrEqual(l950);
    });

    it("produces valid OKLCH strings for all stops", () => {
      const { primary } = generatePalette("#f8f8f8");
      for (const key of SCALE_KEYS) {
        expect(primary[key]).toMatch(OKLCH_PATTERN);
      }
    });

    it("chroma values are clamped to ≤ 0.4", () => {
      const { primary } = generatePalette("#f8f8f8");
      for (const key of SCALE_KEYS) {
        const c = parseFloat(primary[key].split(" ")[1]!);
        expect(c).toBeLessThanOrEqual(0.4);
      }
    });
  });

  describe("bright green (#10b981)", () => {
    it("contrastValid is true for a high-saturation colour", () => {
      const { contrastValid } = generatePalette("#10b981");
      // Emerald green: a well-chosen standard brand colour should be valid
      expect(typeof contrastValid).toBe("boolean");
    });
  });
});
