import { describe, it, expect } from "vitest";
import type { Variants } from "framer-motion";
import { fadeSlideUp, slideInRight, scaleIn, staggerContainer } from "@/lib/motion/variants";

type VariantTarget = Record<string, unknown>;

describe("motion variants", () => {
  describe("fadeSlideUp", () => {
    it("has initial, animate, and exit keys", () => {
      expect(fadeSlideUp).toHaveProperty("initial");
      expect(fadeSlideUp).toHaveProperty("animate");
      expect(fadeSlideUp).toHaveProperty("exit");
    });

    it("animate opacity is 1", () => {
      const animate = fadeSlideUp.animate as VariantTarget;
      expect(animate.opacity).toBe(1);
    });

    it("animate y is 0", () => {
      const animate = fadeSlideUp.animate as VariantTarget;
      expect(animate.y).toBe(0);
    });

    it("initial opacity is 0", () => {
      const initial = fadeSlideUp.initial as VariantTarget;
      expect(initial.opacity).toBe(0);
    });

    it("initial y offset is 8", () => {
      const initial = fadeSlideUp.initial as VariantTarget;
      expect(initial.y).toBe(8);
    });

    it("exit opacity is 0", () => {
      const exit = fadeSlideUp.exit as VariantTarget;
      expect(exit.opacity).toBe(0);
    });

    it("exit y is negative (upward direction)", () => {
      const exit = fadeSlideUp.exit as VariantTarget;
      expect(typeof exit.y).toBe("number");
      expect((exit.y as number) < 0).toBe(true);
    });
  });

  describe("slideInRight", () => {
    it("has initial, animate, and exit keys", () => {
      expect(slideInRight).toHaveProperty("initial");
      expect(slideInRight).toHaveProperty("animate");
      expect(slideInRight).toHaveProperty("exit");
    });

    it("animate opacity is 1", () => {
      const animate = slideInRight.animate as VariantTarget;
      expect(animate.opacity).toBe(1);
    });

    it("animate x is 0", () => {
      const animate = slideInRight.animate as VariantTarget;
      expect(animate.x).toBe(0);
    });

    it("initial x is positive (slides from right)", () => {
      const initial = slideInRight.initial as VariantTarget;
      expect((initial.x as number) > 0).toBe(true);
    });
  });

  describe("scaleIn", () => {
    it("has initial, animate, and exit keys", () => {
      expect(scaleIn).toHaveProperty("initial");
      expect(scaleIn).toHaveProperty("animate");
      expect(scaleIn).toHaveProperty("exit");
    });

    it("animate opacity is 1", () => {
      const animate = scaleIn.animate as VariantTarget;
      expect(animate.opacity).toBe(1);
    });

    it("animate scale is 1", () => {
      const animate = scaleIn.animate as VariantTarget;
      expect(animate.scale).toBe(1);
    });

    it("initial scale is less than 1 (shrunk)", () => {
      const initial = scaleIn.initial as VariantTarget;
      expect((initial.scale as number) < 1).toBe(true);
    });
  });

  describe("staggerContainer", () => {
    it("has animate key", () => {
      expect(staggerContainer).toHaveProperty("animate");
    });

    it("animate has staggerChildren transition", () => {
      const animate = staggerContainer.animate as VariantTarget;
      const transition = animate.transition as VariantTarget;
      expect(typeof transition.staggerChildren).toBe("number");
      expect(transition.staggerChildren).toBeGreaterThan(0);
    });
  });

  describe("all variants are const (exported as named objects)", () => {
    it("fadeSlideUp is a Variants object", () => {
      const v: Variants = fadeSlideUp;
      expect(typeof v).toBe("object");
    });

    it("slideInRight is a Variants object", () => {
      const v: Variants = slideInRight;
      expect(typeof v).toBe("object");
    });

    it("scaleIn is a Variants object", () => {
      const v: Variants = scaleIn;
      expect(typeof v).toBe("object");
    });

    it("staggerContainer is a Variants object", () => {
      const v: Variants = staggerContainer;
      expect(typeof v).toBe("object");
    });
  });
});
