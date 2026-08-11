import { z } from "zod";

/**
 * Wire schemas for the POS terminal catalogue (28-04 → 28-09).
 *
 * <p>Its own module rather than an addition to `pos.schema.ts`, for two reasons and the second is
 * the operative one. The codebase already keeps per-domain files at every layer; and plan 28-10 is
 * editing the shared POS layer files in this same wave, so two agents in one module is the
 * collision phase 19b had to reconcile by hand.
 *
 * <h3>Empty means everything, and there is no flag</h3>
 *
 * A terminal with no category rows offers the WHOLE menu; with no station rows it fires to EVERY
 * station. Plan 28-04 asserts, with a test that queries `information_schema`, that no
 * `serves_all`-shaped column exists — because a flag and the rows it summarises can disagree, and
 * on the day they do nobody can tell which is wrong. The server does send derived
 * `offersWholeMenu` / `firesToAllStations` booleans; the adapter treats them as a convenience and
 * falls back to the array length, so the two can never disagree here either.
 */

export const SERVICE_MODELS = ["COUNTER", "TABLE_SERVICE", "SELF_SERVE"] as const;
export type ApiServiceModel = (typeof SERVICE_MODELS)[number];

export const TERMINAL_ORDER_TYPES = ["DINE_IN", "TAKEAWAY", "DELIVERY", "PICKUP"] as const;

/**
 * `serviceModel` and `defaultOrderType` are plain strings on the wire, narrowed in the adapter, for
 * the same reason `stationType` is: a `z.enum` turns an unrecognised value into a PARSE FAILURE,
 * and a parse failure on a list response empties the whole screen rather than mislabelling one row.
 */
export const apiPosTerminalSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  serviceModel: z.string().nullable().optional(),
  defaultOrderType: z.string().nullable().optional(),
  printerRef: z.string().nullable().optional(),
  active: z.boolean().nullable().optional(),
  categoryIds: z.array(z.string()).nullable().optional(),
  stationIds: z.array(z.string()).nullable().optional(),
  offersWholeMenu: z.boolean().nullable().optional(),
  firesToAllStations: z.boolean().nullable().optional(),
});
export type ApiPosTerminal = z.infer<typeof apiPosTerminalSchema>;

/**
 * Create. `code` is immutable afterwards — a device remembers which terminal it is by that handle,
 * so renaming it would silently re-point every screen that stored it (28-04). Upper-cased on the
 * way out for the same reason a station code is: a handle that differs only by case is two handles.
 */
export const createTerminalInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(100),
  serviceModel: z.enum(SERVICE_MODELS),
  defaultOrderType: z.enum(TERMINAL_ORDER_TYPES),
  /** Empty = offers the whole menu. Always sent, never omitted — see the update note below. */
  categoryIds: z.array(z.string().uuid()),
  /** Empty = fires to every station. */
  stationIds: z.array(z.string().uuid()),
});
export type CreateTerminalInput = z.infer<typeof createTerminalInputSchema>;

/**
 * Update. The scope lists have THREE server-side states — `null` leaves them alone, `[]` widens to
 * everything, populated sets exactly those (28-04). This client always sends explicit arrays,
 * because the form always shows the current selection: omitting them would make "the admin
 * unticked everything" indistinguishable from "the admin only renamed it", and one of those widens
 * a bar terminal to the whole card.
 */
export const updateTerminalInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  serviceModel: z.enum(SERVICE_MODELS),
  defaultOrderType: z.enum(TERMINAL_ORDER_TYPES),
  categoryIds: z.array(z.string().uuid()),
  stationIds: z.array(z.string().uuid()),
});
export type UpdateTerminalInput = z.infer<typeof updateTerminalInputSchema>;
