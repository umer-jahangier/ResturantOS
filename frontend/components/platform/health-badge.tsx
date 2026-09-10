import { StatusBadge, type StatusVariant } from "@/components/ui/status-badge";
import type { HealthState } from "@/lib/models/platform-overview.model";

/**
 * The one mapping from a fleet health state to a badge, for every surface that renders one.
 *
 * <h3>Why this is a module and not a constant repeated in two files</h3>
 *
 * It was repeated in two files: the dashboard's `OverviewSystem` card and the full system status
 * screen both need it. Four states, four variants, four words — small enough to retype and small
 * enough for the retyped copy to drift by one line without anyone noticing. The failure that
 * matters is specific: someone maps `UNKNOWN` to `success` on ONE of the two surfaces "because a
 * grey chip looks broken", and the console then shows green for a component nobody managed to
 * probe, on the page whose entire job is to be believed during an incident.
 *
 * <p>One table, imported by both, is what makes that a change a reviewer sees.
 *
 * <h3>The rule the table encodes</h3>
 *
 * **`UP` is the only state that may be green, and it is the only one that answered and said it was
 * healthy.** The other three are three different kinds of not-knowing and they stay three:
 *
 * <ul>
 *   <li><b>DOWN</b> — it answered, and said it was unhealthy. A real, self-reported fact, and the
 *       only one of the three that is evidence about the component itself.</li>
 *   <li><b>UNREACHABLE</b> — nothing answered within the probe timeout. Consistent with the process
 *       being dead AND with a network partition, a stale registry entry, or the platform service
 *       being the isolated one. Those call for different actions at 3am, which is why the backend
 *       spends a whole enum member keeping it apart from DOWN.</li>
 *   <li><b>UNKNOWN</b> — there was nothing to probe, or the means of probing was unavailable. Not
 *       an outage and not a clean bill of health; the absence of a measurement.</li>
 * </ul>
 *
 * <p>`inactive` for UNKNOWN rather than `warning`: a warning claims something is wrong, and
 * "nobody could check" is not a claim about the component. The word beside the chip carries the
 * meaning either way — hue never travels alone here.
 */
export const HEALTH_STATE_BADGE: Record<HealthState, { variant: StatusVariant; label: string }> = {
  UP: { variant: "success", label: "Up" },
  DOWN: { variant: "error", label: "Down" },
  UNREACHABLE: { variant: "warning", label: "Unreachable" },
  UNKNOWN: { variant: "inactive", label: "Unknown" },
};

/** One line of plain English per state, for a caption or a tooltip. */
export const HEALTH_STATE_MEANING: Record<HealthState, string> = {
  UP: "Answered, and reported itself healthy.",
  DOWN: "Answered, and reported itself unhealthy.",
  UNREACHABLE:
    "Nothing answered within the probe timeout. Not proof of death, and not proof of health.",
  UNKNOWN: "Not determinable — there was nothing to probe, or no means of probing it.",
};

export function HealthBadge({ state }: { state: HealthState }) {
  const descriptor = HEALTH_STATE_BADGE[state];
  return <StatusBadge status={descriptor.variant} label={descriptor.label} />;
}
