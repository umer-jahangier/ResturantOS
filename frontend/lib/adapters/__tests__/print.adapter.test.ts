import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  apiPrintDocumentSchema,
  apiReceiptAmountSchema,
  parsePrintedAmountToPaisa,
} from "@/lib/api-client/schemas/print.schema";
import { adaptPrintDocument } from "@/lib/adapters/print.adapter";

// The ONE golden fixture, read from the repository root with `readFileSync` — NOT imported.
//
// A TypeScript `import` of a JSON file outside this project's rootDir/include fails resolution,
// and the tempting fix is to copy the fixture into `frontend/`, which reintroduces exactly the
// drift a single shared file exists to prevent. A filesystem read involves no bundler and no path
// aliasing and cannot fail that way.
//
// The path is found by walking UP from the working directory, the same way shared-lib's contract
// test finds it. Not `import.meta.url`: under the jsdom environment vitest rewrites that to an
// http URL and `fileURLToPath` throws "The URL must be of scheme file". Not a fixed number of
// `..` segments either, because that silently breaks if the test moves.
const FIXTURE_RELATIVE = join("contracts", "print", "golden-receipt-document.json");

function locateFixture(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, FIXTURE_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `could not find ${FIXTURE_RELATIVE} walking up from ${process.cwd()} — ` +
      "regenerate it with: mvn -pl shared-lib test -Dtest=PrintDocumentContractTest " +
      "-Dprint.fixture.regenerate=true. Do NOT copy it into frontend/.",
  );
}

const FIXTURE_PATH = locateFixture();

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as unknown;
}

/** The fixture with one top-level key removed, for the "this field is required" assertions. */
function withoutKey(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...raw };
  delete copy[key];
  return copy;
}

/** Every path in `value` whose leaf is `undefined`. Nulls are fine; undefined is a dropped field. */
function undefinedPaths(value: unknown, path = "$"): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== "object") return [];
  if (value instanceof Date) return [];
  if (Array.isArray(value)) {
    return value.flatMap((child, i) => undefinedPaths(child, `${path}[${i}]`));
  }
  return Object.entries(value).flatMap(([key, child]) => undefinedPaths(child, `${path}.${key}`));
}

describe("print document wire contract", () => {
  it("parses the Java-produced golden fixture with no unknown-key stripping and no coercion", () => {
    const raw = loadFixture();
    const parsed = apiPrintDocumentSchema.parse(raw);

    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.type).toBe("CUSTOMER_RECEIPT");
    expect(parsed.provenance).toBe("SERVER");
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.taxBreakdown).toHaveLength(2);
    expect(parsed.tenders).toHaveLength(2);

    // No stripping: an unknown key is an ERROR, not silently discarded. Drift in a printed
    // receipt is a customer-visible defect, so it fails loudly at the boundary.
    const withUnknownKey = { ...(raw as Record<string, unknown>), somethingNew: 42 };
    const result = apiPrintDocumentSchema.safeParse(withUnknownKey);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("somethingNew");

    // No coercion: a stringified integer is not an integer.
    const coerced = {
      ...(raw as Record<string, unknown>),
      issue: {
        sequenceNumber: "1042",
        reprint: false,
        issuedAt: "2026-08-11T14:32:07Z",
        originalIssuedAt: null,
      },
    };
    expect(apiPrintDocumentSchema.safeParse(coerced).success).toBe(false);
  });

  it("parses a fixture with the fiscal region absent, and the domain model exposes null not {}", () => {
    const raw = loadFixture() as Record<string, unknown>;

    // Explicitly null (what Jackson emits) …
    const explicitNull = apiPrintDocumentSchema.parse({ ...raw, fiscal: null });
    expect(adaptPrintDocument(explicitNull).fiscal).toBeNull();

    // … and the key absent entirely.
    const absent = apiPrintDocumentSchema.parse(withoutKey(raw, "fiscal"));
    const domain = adaptPrintDocument(absent);
    expect(domain.fiscal).toBeNull();
    expect(domain.fiscal).not.toEqual({});

    // The populated case still arrives intact.
    const populated = adaptPrintDocument(apiPrintDocumentSchema.parse(raw));
    expect(populated.fiscal?.fbrInvoiceNumber).toBe("7000007DI1747300500123");
    expect(populated.fiscal?.qrSizeMm).toBe(25.4);
  });

  it("rejects an amount whose rendered string disagrees with its paisa value, naming the field", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const totals = raw.totals as Record<string, unknown>;

    // The exact defect this refinement exists for: a total rendered 100x too large.
    const tampered = {
      ...raw,
      totals: { ...totals, grandTotal: { paisa: 284347, formatted: "Rs 284,347.00" } },
    };

    const result = apiPrintDocumentSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    const issues = result.error?.issues ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path.join(".")).toBe("totals.grandTotal");
    expect(issues[0]?.message).toContain("disagrees with itself");
    expect(issues[0]?.message).toContain("284347");

    // A garbage string is rejected too, rather than parsing to NaN.
    expect(apiReceiptAmountSchema.safeParse({ paisa: 100, formatted: "n/a" }).success).toBe(false);

    // And the round-trip that must hold for every amount on the paper.
    expect(parsePrintedAmountToPaisa("Rs 2,843.47")).toBe(284347);
    expect(parsePrintedAmountToPaisa("-Rs 100.00")).toBe(-10000);
    expect(parsePrintedAmountToPaisa("Rs 0.00")).toBe(0);
  });

  it("rejects a fixture missing a required envelope field", () => {
    const raw = loadFixture() as Record<string, unknown>;

    for (const field of [
      "schemaVersion",
      "type",
      "provenance",
      "tenantId",
      "branchId",
      "orderId",
      "issue",
      "cut",
    ]) {
      const result = apiPrintDocumentSchema.safeParse(withoutKey(raw, field));
      expect(result.success, `${field} must be required`).toBe(false);
    }
  });

  it("maps every wire field — a silently dropped field fails this test", () => {
    const parsed = apiPrintDocumentSchema.parse(loadFixture());
    const doc = adaptPrintDocument(parsed);

    // 1. Nothing anywhere in the adapted document is `undefined`.
    expect(undefinedPaths(doc)).toEqual([]);

    // 2. The domain model's key set is exactly the one this phase declared. A field added to the
    //    Java record and to the zod schema but forgotten in the adapter shows up here.
    expect(Object.keys(doc).sort()).toEqual(
      [
        "branchId",
        "cut",
        "drawer",
        "fiscal",
        "footer",
        "header",
        "issue",
        "lines",
        "orderId",
        "orderNo",
        "provenance",
        "schemaVersion",
        "taxBreakdown",
        "tenantId",
        "tenders",
        "totals",
        "type",
      ].sort(),
    );

    // 3. Every nested block carries its own full key set.
    expect(Object.keys(doc.issue).sort()).toEqual(
      ["issuedAt", "originalIssuedAt", "reprint", "sequenceNumber"].sort(),
    );
    expect(Object.keys(doc.header ?? {}).sort()).toEqual(
      ["addressLines", "branchName", "logoFileId", "ntn", "phone", "strn"].sort(),
    );
    expect(Object.keys(doc.lines[0] ?? {}).sort()).toEqual(
      ["lineTotal", "modifiers", "name", "note", "quantity", "stationCode", "unitPrice"].sort(),
    );
    expect(Object.keys(doc.totals ?? {}).sort()).toEqual(
      [
        "discount",
        "grandTotal",
        "serviceCharge",
        // F20 — the branch's own wording and the rate, both null on this fixture because it is a
        // pre-F20 document. The renderers fall back to "Service charge" so its Rs 227.06 still
        // reaches the paper; what they no longer do is print the row when there is neither.
        "serviceChargeLabel",
        "serviceChargeRatePercent",
        "subtotal",
        "tax",
      ].sort(),
    );
    expect(Object.keys(doc.taxBreakdown[0] ?? {}).sort()).toEqual(
      ["amount", "label", "ratePercent", "rateCode"].sort(),
    );
    expect(Object.keys(doc.tenders[0] ?? {}).sort()).toEqual(
      // F20 — `tip` is declared on every tender and defaults to a real Rs 0.00 on a document that
      // predates it, so no renderer has to hold a null check.
      ["amountApplied", "amountTendered", "change", "method", "referenceNo", "tip"].sort(),
    );
    expect(Object.keys(doc.fiscal ?? {}).sort()).toEqual(
      ["fbrInvoiceNumber", "logoAssetId", "noticeLine", "qrPayload", "qrSizeMm"].sort(),
    );
    expect(Object.keys(doc.drawer ?? {}).sort()).toEqual(
      ["connectorPin", "kick", "pulseMs"].sort(),
    );

    // 4. The values themselves survived, including the paisa remainder and the timestamps.
    expect(doc.orderNo).toBe("FT-2026-0811-1042");
    expect(doc.issue.issuedAt.toISOString()).toBe("2026-08-11T14:32:07.000Z");
    expect(doc.issue.originalIssuedAt).toBeNull();
    expect(doc.lines[2]?.lineTotal).toEqual({ paisa: 16066, formatted: "Rs 160.66" });
    expect(doc.totals?.grandTotal.formatted).toBe("Rs 2,843.47");
    expect(doc.tenders[1]?.change).toEqual({ paisa: 15653, formatted: "Rs 156.53" });
    expect(doc.drawer).toEqual({ kick: true, connectorPin: 2, pulseMs: 100 });
    expect(doc.cut).toEqual({ mode: "PARTIAL" });
    expect(doc.footer?.lines).toHaveLength(2);
  });

  it("carries a kitchen ticket through the same schema with the money regions absent", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const ticket = apiPrintDocumentSchema.parse({
      ...raw,
      type: "KITCHEN_TICKET",
      totals: null,
      taxBreakdown: [],
      tenders: [],
      fiscal: null,
      drawer: null,
    });

    const doc = adaptPrintDocument(ticket);
    expect(doc.type).toBe("KITCHEN_TICKET");
    expect(doc.totals).toBeNull();
    expect(doc.taxBreakdown).toEqual([]);
    expect(doc.tenders).toEqual([]);
    expect(doc.fiscal).toBeNull();
    expect(doc.drawer).toBeNull();
    expect(undefinedPaths(doc)).toEqual([]);
  });
});
