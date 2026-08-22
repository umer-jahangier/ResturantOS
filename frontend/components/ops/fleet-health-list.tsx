"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import type { FleetHealth, ServiceHealth, ServiceState } from "@/lib/models/ops.model";
import { serviceConsequence, serviceLabel } from "@/components/ops/service-labels";
import { cn } from "@/lib/utils";

/**
 * The fleet, one row per service (S1-09).
 *
 * <h3>Why a list of rows and not a grid of green dots</h3>
 *
 * A status grid answers "how many are up". The question an operator actually has is "what can my
 * staff not do right now, and how long has that been true" — so every row carries four facts and
 * no decoration: what it is called in the business, whether it answered, what stops working while
 * it does not, and when it last answered.
 *
 * <h3>State is never colour alone (§40)</h3>
 *
 * Each row carries an icon AND a word ("Down", "Degraded", "Up"). A red dot on its own is
 * unreadable to a colour-blind operator and invisible to a screen reader, on the one screen whose
 * entire content is a status.
 *
 * <h3>Contract tokens only</h3>
 *
 * Type comes from the `--text-*` roles and colour from the semantic `success`/`warning`/
 * `destructive` tokens, never from Tailwind's stock scale or a raw palette literal — gates G1 and
 * G3 require a new file to be born on-contract, and a health screen that only reads correctly in
 * light mode is a health screen nobody can use at 11pm.
 *
 * <h3>No transform/filter on any of this</h3>
 *
 * Per the project constraint, nothing here sets `transform`, `filter` or `backdrop-filter` — those
 * on a layout ancestor break the receipt print path, and a settings page renders inside the same
 * shell as the receipt surfaces.
 */
export function FleetHealthList({ fleet }: { fleet: FleetHealth }) {
  return (
    <ul className="space-y-2" data-testid="fleet-health-list">
      {fleet.services.map((service) => (
        <ServiceRow key={service.name} service={service} />
      ))}
    </ul>
  );
}

const STATE_COPY: Record<ServiceState, { word: string; Icon: typeof CheckCircle2 }> = {
  UP: { word: "Up", Icon: CheckCircle2 },
  DEGRADED: { word: "Degraded", Icon: AlertTriangle },
  DOWN: { word: "Down", Icon: XCircle },
};

function ServiceRow({ service }: { service: ServiceHealth }) {
  const { word, Icon } = STATE_COPY[service.state];
  const consequence = serviceConsequence(service);
  const isFailing = service.state !== "UP";

  return (
    <li
      data-testid={`fleet-service-${service.name}`}
      data-service={service.name}
      data-state={service.state}
      className={cn(
        "rounded-lg border p-4",
        service.state === "UP" && "border-border bg-card",
        service.state === "DEGRADED" && "border-warning bg-warning/10",
        service.state === "DOWN" && "border-destructive/40 bg-destructive/10",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body font-medium">
            {serviceLabel(service)}{" "}
            <span className="font-mono text-label font-normal text-muted-foreground">
              {service.name}
            </span>
          </p>
          <p className="mt-1 text-small text-muted-foreground">{service.detail}</p>
          {isFailing && consequence && (
            <p className="mt-1 text-small">While it is down, {consequence}.</p>
          )}
        </div>
        <span
          data-testid={`fleet-state-${service.name}`}
          className={cn(
            // FILLED, not outlined. The first build of this pill used
            // `border-success text-success-foreground`, and `--success-foreground` is the colour
            // meant to sit ON a success fill — near-white. Against the card it rendered as an
            // empty white capsule: the word "Up" and its icon were in the DOM, present in the
            // class list, and invisible on screen. Caught by looking at the screenshot rather
            // than at the source, which is the only way that class of defect is ever caught.
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-label font-semibold",
            service.state === "UP" && "bg-success text-success-foreground",
            service.state === "DEGRADED" && "bg-warning text-warning-foreground",
            service.state === "DOWN" && "bg-destructive text-destructive-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {word}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-label text-muted-foreground md:grid-cols-2">
        <div className="flex gap-1.5">
          <dt className="font-medium">Last reachable</dt>
          <dd data-testid={`fleet-last-reachable-${service.name}`}>
            {formatLastReachable(service.lastReachableAt)}
          </dd>
        </div>
        {service.paths.length > 0 && (
          <div className="flex min-w-0 gap-1.5">
            <dt className="font-medium">Serves</dt>
            <dd className="truncate font-mono">{service.paths.join("  ")}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

/**
 * The clock time, plus how long ago — and the literal truth when there is no answer to give.
 *
 * <p>"Not since this gateway started" rather than "Never": the gateway keeps this in memory, so a
 * gateway that restarted two minutes ago genuinely does not know what happened before that.
 * Writing "Never" would be a confident wrong answer on the one screen that exists because the
 * product kept giving confident wrong answers.
 */
export function formatLastReachable(at: Date | null, now: Date = new Date()): string {
  if (!at) return "Not since this gateway started";
  const clock = at.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 10) return `${clock} (just now)`;
  if (seconds < 90) return `${clock} (${seconds}s ago)`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${clock} (${minutes} min ago)`;
  return `${clock} (${Math.round(minutes / 60)} h ago)`;
}
