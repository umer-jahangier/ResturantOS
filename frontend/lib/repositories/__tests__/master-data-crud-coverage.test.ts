import { describe, expect, it } from "vitest";

import { InventoryRepository } from "@/lib/repositories/inventory.repository";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";

/**
 * What "complete master-data CRUD" means for this product, written down and checked.
 *
 * <p>D-36-06 says stock and ingredient management must be complete CRUD in the UI. The 36-01 drive
 * measured which parts actually were, against the live stack rather than against a repository
 * listing: ingredients, item categories and storage locations were complete; a UNIT OF MEASURE
 * could be created and never changed or retired — `PUT /api/v1/inventory/uom/{id}` and
 * `POST .../archive` both answered 404 (finding F-31-04). Floating Terrace's registry still
 * contains a unit coded `TETS`, named "TEST", with a factor of 5 grams, because there has never
 * been a way to remove it.
 *
 * <p><b>An exemption is data with a reason, never an omitted row.</b> A stock level has no create
 * because stock comes into existence through an opening balance or a receipt — saying so here is
 * what stops a later reader "fixing" it by adding one.
 *
 * <p><b>What this test can and cannot prove.</b> It proves the repository layer exposes a call.
 * It does NOT prove the endpoint behind it answers — a method existing and the same operation
 * failing against the live stack are different facts, and the second is what the drive measured.
 * `scripts/e2e/phase31-master-data-e2e.sh` is the other half and asserts the live behaviour of
 * every entity here. Both are needed: this one fails at build time when a call is deleted, that
 * one fails when a call is present and the endpoint is not.
 */

type Op = "create" | "read" | "update" | "retire";

interface Exemption {
  reason: string;
}

interface EntityRow {
  entity: string;
  ops: Partial<Record<Op, string | Exemption>>;
}

function isExempt(v: string | Exemption): v is Exemption {
  return typeof v !== "string";
}

const INVENTORY_MATRIX: EntityRow[] = [
  {
    entity: "ingredient",
    ops: {
      create: "createIngredient",
      read: "listIngredients",
      update: "updateIngredient",
      retire: "archiveIngredient",
    },
  },
  {
    entity: "ingredient category",
    ops: {
      create: "createCategory",
      read: "listCategories",
      update: "updateCategory",
      retire: "archiveCategory",
    },
  },
  {
    entity: "unit of measure",
    ops: {
      create: "createUom",
      read: "listUoms",
      // Both of these were 404 until 36-05. They are the finding this matrix exists to hold closed.
      update: "updateUom",
      retire: "archiveUom",
    },
  },
  {
    entity: "storage location",
    ops: {
      create: "createStorageLocation",
      read: "listStorageLocations",
      update: "updateStorageLocation",
      retire: "archiveStorageLocation",
    },
  },
  {
    entity: "stock level (with reorder point and par level)",
    ops: {
      create: {
        reason:
          "Stock does not get created directly. It comes into existence through an opening " +
          "balance or a goods receipt, which are different economic events with different " +
          "ledger consequences. A 'create stock level' call would be a way to invent inventory.",
      },
      read: "getStockLevels",
      update: {
        reason:
          "A stock LEVEL is not editable — it is the running result of movements. The reorder " +
          "point and par level that govern it live on the ingredient and are asserted on that " +
          "row instead. Editing a level directly would be an unaudited adjustment; a stock " +
          "count is the audited way to say the number is wrong.",
      },
      retire: {
        reason:
          "Retiring the ingredient retires its stock levels with it; a level has no independent " +
          "life to end.",
      },
    },
  },
  {
    entity: "opening stock",
    ops: {
      create: "recordOpeningBalance",
      read: {
        reason:
          "An opening balance is read back as the inventory movement it produced and as the " +
          "on-hand quantity it set, both already covered by the stock-level read. A separate " +
          "list of opening balances would be a second view of the same movements.",
      },
      update: {
        reason:
          "An opening balance is a posted economic event. It is corrected by a stock count, " +
          "which records the variance and its reason, not by editing history.",
      },
      retire: {
        reason: "Same: a posted movement is superseded, never retired.",
      },
    },
  },
];

const PURCHASING_MATRIX: EntityRow[] = [
  {
    entity: "supplier (vendor)",
    ops: {
      create: "createVendor",
      read: "listVendors",
      update: "updateVendor",
      retire: {
        reason:
          "A vendor is deactivated through `updateVendor` with `active: false` rather than by a " +
          "dedicated archive call — the field is on the vendor record itself and the list " +
          "endpoint filters on it. Recorded rather than 'fixed': adding a second way to " +
          "deactivate would be two paths to one state.",
      },
    },
  },
];

function assertRow(row: EntityRow, repo: Record<string, unknown>, repoName: string) {
  for (const op of ["create", "read", "update", "retire"] as Op[]) {
    const spec = row.ops[op];
    expect(
      spec,
      `${row.entity}: the matrix says nothing about "${op}". Every entity must either
name the method or declare an exemption with a reason — an omitted row is how a gap becomes
invisible.`,
    ).toBeDefined();

    if (isExempt(spec!)) {
      expect(
        spec.reason.length,
        `${row.entity} exempts "${op}" with an empty reason. An exemption invented to make a test
pass is worse than a failing test.`,
      ).toBeGreaterThan(20);
      continue;
    }

    const method = spec as string;
    expect(
      typeof repo[method],
      `${row.entity} has no "${op}" path: ${repoName}.${method} does not exist. This is the shape of
finding F-31-04 — a unit of measure could be created and never changed or retired, and the gap was
only discovered by a person trying to use the product.`,
    ).toBe("function");
  }
}

describe("master data is complete CRUD, entity by entity (D-36-06)", () => {
  for (const row of INVENTORY_MATRIX) {
    it(`${row.entity} — create, read, change, retire`, () => {
      assertRow(
        row,
        InventoryRepository as unknown as Record<string, unknown>,
        "InventoryRepository",
      );
    });
  }

  for (const row of PURCHASING_MATRIX) {
    it(`${row.entity} — create, read, change, retire`, () => {
      assertRow(
        row,
        PurchasingRepository as unknown as Record<string, unknown>,
        "PurchasingRepository",
      );
    });
  }

  it("reorder point and par level are SETTABLE, not merely readable", () => {
    // The reorder suggestion path is built entirely on these two numbers. A form that displays
    // them and cannot save them is the same class of defect as a screen that shows an empty list
    // when the request failed — it looks like the feature is there.
    const create = InventoryRepository.createIngredient.toString();
    const update = InventoryRepository.updateIngredient.toString();
    for (const [name, src] of [
      ["createIngredient", create],
      ["updateIngredient", update],
    ] as const) {
      expect(
        src.includes("createIngredientInputSchema") || src.includes("updateIngredientInputSchema"),
        `${name} must send its payload through the ingredient input schema, which is where
reorderPoint and parLevel are declared. Bypassing it is how a field silently stops being sent.`,
      ).toBe(true);
    }
  });

  it("opening stock has a write path distinct from a goods receipt", () => {
    // Different economic events with different ledger consequences. One endpoint serving both
    // would make them indistinguishable in the movement history, which is where the difference
    // has to be visible.
    expect(typeof InventoryRepository.recordOpeningBalance).toBe("function");
    expect(typeof InventoryRepository.receiveStock).toBe("function");
    expect(InventoryRepository.recordOpeningBalance).not.toBe(InventoryRepository.receiveStock);
  });
});
