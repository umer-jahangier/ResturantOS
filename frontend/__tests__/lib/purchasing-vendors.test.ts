import { describe, expect, it } from "vitest";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";

describe("PurchasingRepository vendor CRUD (PUR-01, MSW round-trip)", () => {
  it("creates a vendor and returns only the last 4 bank digits, never the account number", async () => {
    const created = await PurchasingRepository.createVendor({
      name: "Value Meats",
      paymentTerms: "NET15",
      contactPerson: "Bilal",
      bankAccountNo: "PK36SCBL0000001123456702",
    });

    expect(created.name).toBe("Value Meats");
    expect(created.bankAccountLast4).toBe("6702");
    // The full account must never survive the round-trip in any field.
    expect(JSON.stringify(created)).not.toContain("1123456702");
  });

  it("lists the newly created vendor alongside the seeded one", async () => {
    const list = await PurchasingRepository.listVendors();
    expect(list.map((v) => v.name)).toContain("Value Meats");
    expect(list.map((v) => v.name)).toContain("Fresh Foods Ltd");
  });

  it("updates a vendor's details without a bank account, preserving the stored account", async () => {
    const list = await PurchasingRepository.listVendors();
    const target = list.find((v) => v.name === "Value Meats")!;

    const updated = await PurchasingRepository.updateVendor(target.id, {
      name: "Value Meats (Gulberg)",
      paymentTerms: "NET30",
      // bankAccountNo omitted — the encrypted account on file must be left untouched.
    });

    expect(updated.name).toBe("Value Meats (Gulberg)");
    expect(updated.paymentTerms).toBe("NET30");
    expect(updated.bankAccountLast4).toBe("6702");
  });

  it("replaces the bank account when a new number is supplied", async () => {
    const list = await PurchasingRepository.listVendors();
    const target = list.find((v) => v.name === "Value Meats (Gulberg)")!;

    const updated = await PurchasingRepository.updateVendor(target.id, {
      name: target.name,
      paymentTerms: target.paymentTerms,
      bankAccountNo: "PK11ABCD0000009999888811",
    });

    expect(updated.bankAccountLast4).toBe("8811");
  });

  it("rejects a vendor with no name before it reaches the network", async () => {
    await expect(
      PurchasingRepository.createVendor({ name: "", paymentTerms: "NET30" }),
    ).rejects.toThrow();
  });
});
