import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { ApiError } from "@/lib/errors/api-error";
import { formatUserFacingError } from "@/lib/errors/user-facing";

/**
 * What a server explains has to survive the trip to the screen.
 *
 * <h2>What was broken</h2>
 *
 * `sanitizeMessage` replaced ANY message longer than 160 characters with "Something went wrong.
 * Please try again." The cap was there for a good reason — it kept raw Zod dumps and JSON blobs
 * off the screen — but it is length-based, so it could not tell a dump from a carefully written
 * refusal. The consequence was inverted: the more a backend explained, the more likely the user
 * saw nothing.
 *
 * <p>Found live during S2. auth-service's role-ceiling refusal on revoke ran to 171 characters and
 * reached the confirmation dialog as exactly the generic sentence — an owner pressing Revoke saw a
 * generic error where the server had explained precisely why the role could not be removed
 * (`.planning/audits/floor/S2/_prove.json`, `CEILING_uiRefusal` on the first run). S2 shortened its
 * own sentence at the source and pinned the budget with `RoleCeilingRefusalCopyTest`, but that was
 * one message out of a fleet.
 *
 * <h2>Why these fixtures</h2>
 *
 * The survival cases are not invented strings. Each is a REAL message from a service, rendered
 * with production-shaped values (UUIDs are 36 characters, and that is most of why several of these
 * are long), taken from an audit of every `RestaurantOsException` subclass and throw site in the
 * fleet. Every one of them rendered as "Something went wrong" before this change.
 *
 * <p>Each survival case asserts its own fixture is over the OLD cap before asserting the fixture
 * survives. Without that guard a later well-meaning edit that shortens a fixture would leave the
 * test passing while testing nothing — which is the precise way this defect stayed invisible.
 */

const GENERIC = "Something went wrong. Please try again.";
const OLD_CAP = 160;

/** A real UUID, from the S2 revoke fixtures — the length is the point. */
const UUID = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";

/** Code → message, for codes with NO entry in `USER_FACING_BY_CODE`, so the server's text is what
 * the user actually reads. Rendered exactly as the service builds them. */
const REAL_FLEET_REFUSALS: { code: string; where: string; message: string }[] = [
  {
    code: "GRN_UOM_UNRESOLVABLE",
    where: "inventory-service GrnUomResolver.java:120",
    message:
      `GRN ${UUID}: cannot convert 'CASE' into ingredient ${UUID}'s stock unit 'KG' — that is ` +
      "not a unit this tenant defines. Fix the vendor catalog row's pack unit, or add the unit " +
      "in Inventory > Setup. The receipt is refused rather than recorded at face value, which " +
      "would add the wrong quantity at the wrong unit cost and be invisible afterwards.",
  },
  {
    code: "INGREDIENT_NOT_FOUND",
    where: "purchasing-service PoLineValidityGate.java:149",
    message:
      "These purchase-order lines name an ingredient that is not in this tenant's inventory, so " +
      `a goods receipt against them would create no stock and no ledger entry: ${UUID}, ${UUID}. ` +
      "Choose an ingredient that exists, or create it in Inventory first.",
  },
  {
    code: "STATE_INVALID",
    where: "hr-service PayrollRunService.java:166 (PAYSLIP_NET_NEGATIVE)",
    message:
      `Payslip for employee ${UUID} (EMP-00147) in run ${UUID} has a negative net of -125000 ` +
      "paisa: gross=4500000, incomeTax=225000, eobi=13500, advances=4800000, lateArrival=86500. " +
      "Correct the salary, the advance or the attendance policy and recalculate.",
  },
  {
    code: "TIER_LIMIT_EXCEEDED",
    where: "platform-admin-service TierLimitExceededException",
    message:
      "Downgrade to STARTER refused — the tenant is already over the target tier's limits " +
      "(branches: in use 12, target tier allows 3; users: in use 48, target tier allows 10). " +
      "Reduce usage first, or repeat the request with force=true to apply the tier anyway.",
  },
  {
    code: "PACK_UOM_INVALID",
    where: "purchasing-service PackUomInvalidException",
    message:
      "'CTN' is not a unit of measure in this tenant. Goods receipts are converted from the pack " +
      "unit into the ingredient's stock unit, so it must be one of: KG, G, L, ML, EACH, CASE, " +
      "BOX, DOZEN, PACK, BOTTLE, CAN, TRAY, …",
  },
  {
    code: "STATE_INVALID",
    where: "user-service ReceiptConfigService.java:99",
    message:
      `Branch ${UUID} has a stored receipt configuration that cannot be read. It predates the ` +
      "validated endpoint or was written by hand. Re-save it through PUT " +
      "/api/v1/branches/{id}/receipt-config to repair it.",
  },
];

function apiError(code: string, message: string, status = 409) {
  return new ApiError({ code, message, status, traceId: null, fieldErrors: [] });
}

describe("a server refusal longer than a tweet still reaches the reader", () => {
  it.each(REAL_FLEET_REFUSALS)(
    "shows $code from $where verbatim",
    ({ code, message }) => {
      // The guard: if this fixture ever drops under the old cap, the case below stops proving
      // anything and this line says so instead of passing quietly.
      expect(message.length).toBeGreaterThan(OLD_CAP);

      expect(formatUserFacingError(apiError(code, message))).toBe(message);
    },
  );

  /**
   * The one that was actually measured failing on a screen. Kept as its own case, separate from
   * the table, because it is the regression rather than an example of the class.
   */
  it("shows the 171-character role-ceiling refusal that S2 caught rendering as the generic", () => {
    const refusal =
      "You cannot revoke the role INVENTORY_MANAGER_ASSISTANT at Floating Terrace — Rooftop: it " +
      "grants 12 permission(s) you do not hold yourself. Ask an administrator who holds them.";

    expect(refusal.length).toBeGreaterThan(OLD_CAP);
    expect(formatUserFacingError(apiError("ROLE_CEILING_EXCEEDED", refusal, 403))).toBe(refusal);
  });
});

describe("machine output is still kept off the screen", () => {
  it("swallows a Zod issue array, however long", () => {
    const dump = JSON.stringify(
      [{ code: "invalid_type", expected: "string", received: "number", path: ["name"] }],
      null,
      2,
    );
    expect(formatUserFacingError(apiError("PARSE_FAILED", dump))).toBe(GENERIC);
  });

  it("swallows a Zod issue shape that never says invalid_type", () => {
    // `too_small` was invisible to the old literal-only test; the leading `[` caught it, but a
    // single unwrapped issue object would not have been.
    const dump = '{"code":"too_small","minimum":1,"path":["lines"],"message":"Required"}';
    expect(formatUserFacingError(apiError("PARSE_FAILED", dump))).toBe(GENERIC);
  });

  it("swallows a stack trace", () => {
    const trace =
      "TypeError: Cannot read properties of undefined (reading 'id')\n" +
      "    at OrderTotals (webpack-internal:///./components/pos/order-totals.tsx:41:19)\n" +
      "    at renderWithHooks (webpack-internal:///./node_modules/react-dom/cjs/react-dom.js:1)";
    expect(formatUserFacingError(apiError("INTERNAL", trace, 500))).toBe(GENERIC);
  });

  it("swallows a JVM stack trace", () => {
    const trace =
      "java.lang.NullPointerException: Cannot invoke \"Ingredient.getBaseUomCode()\"\n" +
      "\tat io.restaurantos.inventory.service.GrnUomResolver.toBaseUnits(GrnUomResolver.java:109)\n" +
      "\tat io.restaurantos.inventory.service.GrnService.receive(GrnService.java:88)";
    expect(formatUserFacingError(apiError("INTERNAL", trace, 500))).toBe(GENERIC);
  });

  it("swallows an HTML error page from a proxy", () => {
    const page =
      "<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1>" +
      "</center><hr><center>nginx/1.25.3</center></body></html>";
    expect(formatUserFacingError(apiError("BAD_GATEWAY", page, 502))).toBe(GENERIC);
  });

  it("swallows a serialised JSON body", () => {
    const body = JSON.stringify({
      timestamp: "2026-08-12T09:14:22.113Z",
      status: 500,
      error: "Internal Server Error",
      path: "/api/v1/purchasing/purchase-orders",
    });
    expect(formatUserFacingError(apiError("INTERNAL", body, 500))).toBe(GENERIC);
  });

  it("swallows a prose-shaped string past the residual backstop", () => {
    // No structural marker at all — just implausibly long for a sentence aimed at a person.
    const blob = `${"The request could not be completed. ".repeat(20)}`;
    expect(blob.length).toBeGreaterThan(600);
    expect(formatUserFacingError(apiError("STATE_INVALID", blob))).toBe(GENERIC);
  });

  it("keeps a message that sits just under the backstop", () => {
    const long = `${"a".repeat(599)}`;
    expect(formatUserFacingError(apiError("STATE_INVALID", long))).toBe(long);
  });

  it("swallows an empty or whitespace-only message", () => {
    expect(formatUserFacingError(apiError("STATE_INVALID", ""))).toBe(GENERIC);
    expect(formatUserFacingError(apiError("STATE_INVALID", "   \n  "))).toBe(GENERIC);
  });
});

describe("the parts that must not have moved", () => {
  it("still prefers the client's own copy for a mapped code, however long the server's text", () => {
    const verbose = `Journal entry is unbalanced. ${"Detail. ".repeat(40)}`;
    expect(formatUserFacingError(apiError("JE_UNBALANCED", verbose))).toBe(
      "Journal entry lines must balance (total debit must equal total credit).",
    );
    expect(formatUserFacingError(apiError("PERMISSION_DENIED", verbose, 403))).toBe(
      "You don't have permission to perform this action.",
    );
  });

  it("still tells the user the RESPONSE was unreadable, not that something went wrong", () => {
    // A schema mismatch is a different situation to a refusal, and keeps its own sentence.
    const parseFailure = "We couldn't read the server response. Please refresh and try again.";
    const zodish = new Error('[{"code":"invalid_type","path":["data","id"]}]');
    expect(formatUserFacingError(zodish)).toBe(parseFailure);

    const zodError = new ZodError([
      { code: "invalid_type", expected: "string", received: "number", path: ["id"], message: "x" },
    ] as never);
    expect(formatUserFacingError(zodError)).toBe(parseFailure);
  });

  it("still falls back for a non-Error throw", () => {
    expect(formatUserFacingError("a bare string")).toBe(GENERIC);
    expect(formatUserFacingError(null)).toBe(GENERIC);
    expect(formatUserFacingError(undefined)).toBe(GENERIC);
  });

  it("passes an ordinary short refusal through untouched", () => {
    const short = "This table is already occupied.";
    expect(formatUserFacingError(apiError("STATE_INVALID", short))).toBe(short);
  });
});
