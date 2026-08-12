import type { ApiAuditEvent, ApiAuditFacets } from "@/lib/api-client/schemas/audit.schema";
import type { AuditEvent, AuditFacets } from "@/lib/models/audit.model";

/**
 * The keys an event uses to record WHY, most specific first.
 *
 * <p>Read rather than assumed: `ORDER_VOIDED` and `ORDER_REFUNDED` write `reason`, and the till
 * events write `note`. A row whose payload uses neither simply has no reason, which is different
 * from having an empty one — see {@link AuditEvent.reason}.
 */
const REASON_KEYS = ["reason", "voidReason", "refundReason", "note"] as const;

/**
 * `new Date("nonsense")` renders as "Invalid Date" in the middle of a sentence about who did what.
 * An unparseable instant becomes the epoch instead, which the row formatter shows as "—" and which
 * cannot be mistaken for a real time. Returning null would push the same check into every consumer.
 */
function toDate(raw: string | null | undefined): Date {
  if (!raw) return new Date(0);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

/**
 * The recorded payload, or an honest admission that it could not be read.
 *
 * <p>Never throws. The payload is a `jsonb` column serialised as text, and this screen's whole
 * value is completeness — one row with an odd payload must not take the other forty-nine with it.
 */
function parseDetails(raw: string | null | undefined): {
  details: Record<string, unknown>;
  unreadable: boolean;
} {
  if (!raw || raw.trim() === "") return { details: {}, unreadable: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { details: parsed as Record<string, unknown>, unreadable: false };
    }
    // Valid JSON that is not an object — a bare string or number. Keep it, labelled.
    return { details: { value: parsed }, unreadable: false };
  } catch {
    return { details: {}, unreadable: true };
  }
}

function firstReason(details: Record<string, unknown>): string | null {
  for (const key of REASON_KEYS) {
    const value = details[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/** A blank string from the wire is "not recorded", not a value. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function adaptAuditEvent(api: ApiAuditEvent): AuditEvent {
  const { details, unreadable } = parseDetails(api.afterState);
  return {
    id: api.id,
    occurredAt: toDate(api.occurredAt),
    action: api.action,
    resourceType: blankToNull(api.resourceType),
    resourceId: blankToNull(api.resourceId),
    branchId: blankToNull(api.branchId),
    actorId: blankToNull(api.userId),
    actorName: blankToNull(api.userName),
    impersonatorId: blankToNull(api.impersonatedBy),
    impersonatorName: blankToNull(api.impersonatedByName),
    reason: firstReason(details),
    details,
    detailsUnreadable: unreadable,
  };
}

export function adaptAuditFacets(api: ApiAuditFacets): AuditFacets {
  return {
    actions: api.actions ?? [],
    resourceTypes: api.resourceTypes ?? [],
  };
}
