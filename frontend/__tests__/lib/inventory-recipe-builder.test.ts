import { describe, expect, it } from "vitest";
import { InventoryRepository } from "@/lib/repositories/inventory.repository";

describe("InventoryRepository recipe-builder + coverage (INV-10/INV-11, MSW round-trip)", () => {
  it("lists the seeded menu-item catalog, ingredients, and UOMs, Zod-parsed without throwing", async () => {
    const menuItems = await InventoryRepository.listMenuItems();
    expect(menuItems.map((mi) => mi.name)).toContain("Zinger Burger");
    expect(menuItems.map((mi) => mi.name)).toContain("Chicken Biryani");

    const ingredients = await InventoryRepository.listIngredients();
    expect(ingredients.map((i) => i.name)).toContain("Chicken");
    expect(ingredients.map((i) => i.name)).toContain("Flour");

    const uoms = await InventoryRepository.listUoms();
    expect(uoms.map((u) => u.code)).toContain("kg");
  });

  it("creates a recipe via createRecipe and round-trips the submitted menuItemId, version 1, and lines", async () => {
    const menuItems = await InventoryRepository.listMenuItems();
    const cake = menuItems.find((mi) => mi.name === "Chocolate Cake")!;
    const ingredients = await InventoryRepository.listIngredients();
    const sugar = ingredients.find((i) => i.name === "Sugar")!;
    const flour = ingredients.find((i) => i.name === "Flour")!;

    const created = await InventoryRepository.createRecipe({
      menuItemId: cake.menuItemId,
      yieldServings: "8",
      name: "Chocolate Cake v1",
      lines: [
        { ingredientId: sugar.id, qty: "0.3", uomCode: "kg", yieldPct: 100 },
        { ingredientId: flour.id, qty: "0.5", uomCode: "kg" },
      ],
    });

    expect(created.menuItemId).toBe(cake.menuItemId);
    expect(created.version).toBe(1);
    expect(created.lines).toHaveLength(2);
    expect(created.lines.map((l) => l.ingredientId)).toEqual(
      expect.arrayContaining([sugar.id, flour.id]),
    );
  });

  it("getCoverage returns the MSW-seeded totals/covered/missing shape", async () => {
    const coverage = await InventoryRepository.getCoverage();
    expect(coverage.totalActiveMenuItems).toBeGreaterThanOrEqual(3);
    expect(typeof coverage.covered).toBe("number");
    expect(Array.isArray(coverage.missing)).toBe(true);
  });

  it("rejects createRecipe with an empty lines array before any network call", async () => {
    const menuItems = await InventoryRepository.listMenuItems();
    const target = menuItems[0]!;
    await expect(
      InventoryRepository.createRecipe({
        menuItemId: target.menuItemId,
        yieldServings: "1",
        lines: [],
      }),
    ).rejects.toThrow();
  });
});
