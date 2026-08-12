import { z } from "zod";

/**
 * Layer-1 wire shape for `GET /api/v1/ops/health` (S1-09), served by the GATEWAY itself.
 *
 * <h3>`state` is a plain string, not a `z.enum`</h3>
 *
 * The same rule the station and routing schemas record, and it matters more here than anywhere:
 * this is the screen an operator opens when things are already going wrong. A fourth state added
 * server-side must not turn the health screen itself into a parse failure — "the page that tells
 * you what is broken is broken" is the one outcome this feature cannot have. The narrowing happens
 * in the adapter, where an unrecognised value degrades to DEGRADED (see the note there for why it
 * is DEGRADED and not UP).
 */
export const apiServiceHealthSchema = z.object({
  name: z.string(),
  paths: z.array(z.string()).nullable().optional(),
  state: z.string(),
  detail: z.string().nullable().optional(),
  /** ISO-8601 instant, or null when this gateway has never had a healthy answer from it. */
  lastReachableAt: z.string().nullable().optional(),
  instanceCount: z.number().int().nullable().optional(),
});
export type ApiServiceHealth = z.infer<typeof apiServiceHealthSchema>;

export const apiFleetHealthSchema = z.object({
  /** Null until the gateway's first probe sweep completes. */
  checkedAt: z.string().nullable().optional(),
  services: z.array(apiServiceHealthSchema).nullable().optional(),
});
export type ApiFleetHealth = z.infer<typeof apiFleetHealthSchema>;
