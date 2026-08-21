import type { ApiPosTerminal } from "@/lib/api-client/schemas/terminal.schema";
import type { PosTerminal, ServiceModel, TerminalOrderType } from "@/lib/models/terminal.model";

const SERVICE_MODEL_SET = new Set<ServiceModel>(["COUNTER", "TABLE_SERVICE", "SELF_SERVE"]);
const ORDER_TYPE_SET = new Set<TerminalOrderType>(["DINE_IN", "TAKEAWAY", "DELIVERY", "PICKUP"]);

/**
 * Wire → domain for a POS terminal.
 *
 * <h3>The scope booleans are DERIVED here, not trusted</h3>
 *
 * `PosTerminalDto` sends `offersWholeMenu` and `firesToAllStations`, and they are computed from the
 * same lists it sends beside them. This adapter recomputes them from the arrays anyway. That is not
 * distrust of the server — it is the same rule 28-04 enforced in the schema with a test that
 * forbids a `serves_all` column: a summary and the rows it summarises are two representations of
 * one fact, and the moment they can disagree, a reader has no way to tell which one is wrong. One
 * representation crosses the wire; the derivation happens once, here.
 *
 * <h3>Unknown enum values degrade rather than throw</h3>
 *
 * An unrecognised `serviceModel` becomes COUNTER and an unrecognised `defaultOrderType` becomes
 * DINE_IN — the same defaults the server applies. Neither is a security control (the DTO's javadoc
 * says so of `ServiceModel` explicitly), so a mislabelled row is cosmetic while a thrown parse
 * error empties the catalogue.
 */
export function adaptPosTerminal(raw: ApiPosTerminal): PosTerminal {
  const model = raw.serviceModel?.toUpperCase();
  const orderType = raw.defaultOrderType?.toUpperCase();
  const categoryIds = raw.categoryIds ?? [];
  const stationIds = raw.stationIds ?? [];

  return {
    id: raw.id,
    branchId: raw.branchId,
    code: raw.code,
    name: raw.name,
    serviceModel:
      model && SERVICE_MODEL_SET.has(model as ServiceModel) ? (model as ServiceModel) : "COUNTER",
    defaultOrderType:
      orderType && ORDER_TYPE_SET.has(orderType as TerminalOrderType)
        ? (orderType as TerminalOrderType)
        : "DINE_IN",
    printerRef: raw.printerRef ?? null,
    // Defaults to TRUE: an absent flag rendering every terminal as retired is the "screen looks
    // empty and nothing errored" failure this phase keeps closing.
    active: raw.active ?? true,
    categoryIds,
    stationIds,
    offersWholeMenu: categoryIds.length === 0,
    firesToAllStations: stationIds.length === 0,
  };
}
