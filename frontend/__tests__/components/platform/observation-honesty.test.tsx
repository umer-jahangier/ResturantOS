import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuditVerdictNotice } from "@/components/platform/audit-verdict-notice";
import { HEALTH_STATE_BADGE } from "@/components/platform/health-badge";
import { SparseSeriesChart } from "@/components/platform/sparse-series-chart";
import { auditVerdict, type PlatformAuditPage } from "@/lib/models/platform-audit.model";
import {
  meterUnavailableReason,
  type HonestSeries,
  type MeterRollup,
} from "@/lib/models/platform-analytics.model";

import { FRONTEND_ROOT, stripComments } from "../../lib/theme/module-graph";

/**
 * Three rules the analytics, audit and system screens are built on, asserted rather than argued.
 *
 * <h3>Why these three and not a render test per screen</h3>
 *
 * Each of them is a place where the WRONG behaviour is the tidier-looking one, which is what makes
 * a code review an unreliable defence:
 *
 * <ol>
 *   <li><b>An empty audit result is not "no events".</b> The calm empty state is what a reviewer
 *       expects to see, and it is the defect.</li>
 *   <li><b>A gap in a series is not a zero.</b> A dense array draws a prettier chart, and the
 *       prettier chart is the one that invents a past.</li>
 *   <li><b>UNKNOWN is not green.</b> A grey chip looks broken next to a row of green ones, and
 *       "fixing" it is a one-word edit.</li>
 * </ol>
 *
 * <h3>Negative controls — run, OBSERVED RED, restored (D-38-07)</h3>
 *
 * 1. Changed `auditVerdict`'s final line to `return { kind: "filteredEmpty" }`. → RED: "an
 *    unfiltered empty result is reported as unverified, never as an empty log". Restored.
 * 2. Moved the `tenantsFailed` check below the `events.length > 0` check. → RED: "a page with rows
 *    AND an unread tenant is still a partial view". Restored.
 * 3. Made `segmentsOf` join every point into one run (neutralised the tolerance comparison).
 *    → **GREEN on the first attempt**, and that is the most useful thing in this file.
 *
 *    The fixture was Feb, Mar, Jun: two runs, but the second held a single observation, and a run
 *    of one draws no polyline. So the CORRECT rendering produced one polyline and the BROKEN one
 *    produced one polyline, and `toHaveLength(1)` passed under both. The assertion looked like a
 *    gate on the component's central claim and was a gate on nothing — the same shape of defect the
 *    component itself exists to prevent, one level up: an absence of evidence rendering as a pass.
 *
 *    Fixed by adding a fourth point (Feb, Mar — gap — Jun, Jul) so the second run has a line of its
 *    own, and by asserting each segment carries exactly its own two points rather than only
 *    counting segments. Re-run: → RED on two tests, "a gap in the observations breaks the line" and
 *    "an isolated observation is a dot with no line". Restored.
 * 4. Set `HEALTH_STATE_BADGE.UNKNOWN` to `{ variant: "success", label: "Unknown" }`. → RED on two
 *    tests: "UP is the only state that may render green" and the four-distinct-renderings one.
 *    Restored.
 * 5. Added `?? 0` to `adaptMeterRollup`'s `total`. → RED: "the analytics adapter and model coalesce
 *    nothing to zero". Restored.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function auditPage(overrides: Partial<PlatformAuditPage> = {}): PlatformAuditPage {
  return {
    events: [],
    totalCount: 0,
    totalCountComplete: true,
    tenantsInScope: 4,
    tenantsRead: 4,
    tenantsFailed: [],
    from: new Date("2026-05-24T00:00:00Z"),
    to: new Date("2026-08-22T23:59:59Z"),
    zone: "Asia/Karachi",
    page: 0,
    size: 50,
    actionsPresent: [],
    scanTruncated: false,
    ...overrides,
  };
}

const EVENT = {
  id: 1,
  tenantId: "11111111-1111-1111-1111-111111111111",
  tenantSlug: "control-bistro",
  tenantBrandName: "Control Bistro",
  occurredAt: new Date("2026-08-01T09:00:00Z"),
  action: "USER_LOGIN_SUCCEEDED",
  resourceType: null,
  resourceId: null,
  branchId: null,
  userId: null,
  impersonatedBy: null,
  ipAddress: null,
  userAgent: null,
  metadata: null,
};

/** Two observations in adjacent months, then a two-month hole, then one more. */
function series(points: Array<[string, number]>): HonestSeries {
  return {
    metric: "tenants_created",
    interval: "MONTH",
    zone: "Asia/Karachi",
    windowFrom: new Date("2026-01-01T00:00:00Z"),
    windowTo: new Date("2026-08-31T00:00:00Z"),
    observedFrom: points.length > 0 ? new Date(points[0]![0]) : null,
    observedTo: points.length > 0 ? new Date(points[points.length - 1]![0]) : null,
    baselineBeforeWindow: 0,
    points: points.map(([iso, count]) => ({
      bucketStart: new Date(iso),
      bucketLabel: iso.slice(0, 7),
      count,
      cumulative: null,
    })),
    backFilled: false,
    coverage: "Counted from tenants.created_at.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 1 — an empty audit result is not a fact about activity
// ─────────────────────────────────────────────────────────────────────────────

describe("an empty audit log is never reported as 'no events'", () => {
  it("an unfiltered empty result is reported as unverified, never as an empty log", () => {
    // Every tenant reported a SUCCESSFUL read and returned nothing. That is what an RLS-filtered
    // fan-out looks like, and it is also what a genuinely quiet platform looks like.
    expect(auditVerdict(auditPage(), false)).toEqual({ kind: "unverified", tenantsRead: 4 });
  });

  it("a filtered empty result is ordinary, and is told apart from the unverified case", () => {
    expect(auditVerdict(auditPage(), true)).toEqual({ kind: "filteredEmpty" });
  });

  it("no tenants at all is its own sentence, not an empty audit log", () => {
    expect(auditVerdict(auditPage({ tenantsInScope: 0, tenantsRead: 0 }), false)).toEqual({
      kind: "noTenants",
    });
  });

  it("a page with rows AND an unread tenant is still a partial view", () => {
    const failures = [{ tenantId: "t-9", tenantSlug: "floating-terrace", reason: "timeout" }];
    const verdict = auditVerdict(
      auditPage({ events: [EVENT], totalCount: 1, tenantsFailed: failures }),
      false,
    );
    // Not `{ kind: "rows" }`: some rows arriving is not evidence about the tenant that did not
    // answer, and the total is a lower bound whatever else is on screen.
    expect(verdict).toEqual({ kind: "partial", failures });
  });

  it("the unverified notice warns and does not tell the reader there were no events", () => {
    render(
      <AuditVerdictNotice
        verdict={{ kind: "unverified", tenantsRead: 4 }}
        windowLabel="24 May 2026 — 22 Aug 2026"
      />,
    );

    const notice = screen.getByTestId("audit-unverified");
    expect(notice).toBeInTheDocument();

    // NOT "the string 'no events' must be absent". The notice legitimately reports what the
    // service returned — the first draft of this assertion banned the phrase outright and failed
    // on the sentence "returned no events at all", which is a true statement about the RESPONSE.
    // What must be absent is the CLAIM: an empty result presented as a settled fact about
    // activity. So the assertions are on the qualification, and on the absence of the calm
    // empty-state shape that would carry the claim.
    expect(notice.textContent).toMatch(/has not been confirmed as an empty log/i);
    expect(notice.textContent).toMatch(/cannot tell them apart/i);
    // The mechanism, named, so the reader can check it rather than take this on trust.
    expect(notice.textContent).toMatch(/row-level security/i);

    // `EmptyState` renders its title at the `text-h2` role. Its presence here would mean the
    // uncertain case had been rendered with the reassuring component after all.
    expect(document.querySelector(".text-h2")).toBeNull();

    // Announced, because a reader who scrolled past the grid must still be told.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("the filtered-empty notice offers the way out of the filter and no create affordance", () => {
    render(
      <AuditVerdictNotice
        verdict={{ kind: "filteredEmpty" }}
        windowLabel="24 May 2026 — 22 Aug 2026"
        onClearFilters={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /clear all/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new|create|add/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 2 — a gap is not a zero
// ─────────────────────────────────────────────────────────────────────────────

describe("a series plots what was observed and nothing else", () => {
  /*
   * Feb, Mar — gap — Jun, Jul. FOUR points and TWO runs, chosen that way after the first version
   * of this fixture failed its own negative control.
   *
   * That version was Feb, Mar, Jun: two runs, but the second is a single observation and a run of
   * one draws no polyline. So the correct rendering produced ONE polyline — and so did the broken
   * rendering that joined all three. The assertion passed under both behaviours and proved
   * nothing. A fourth point gives the second run a line of its own, which is what makes the two
   * cases distinguishable at all.
   */
  const sparse = series([
    ["2026-02-01T00:00:00Z", 2],
    ["2026-03-01T00:00:00Z", 3],
    ["2026-06-01T00:00:00Z", 1],
    ["2026-07-01T00:00:00Z", 4],
  ]);

  it("draws one point per observation and never one per period", () => {
    render(
      <SparseSeriesChart
        series={[{ label: "Created", series: sparse, colorVar: "--chart-1" }]}
        windowFrom={sparse.windowFrom}
        windowTo={sparse.windowTo}
      />,
    );
    // Four observations across an eight-month window. A back-filled chart would have eight.
    expect(screen.getAllByTestId("sparse-series-point")).toHaveLength(4);
  });

  it("a gap in the observations breaks the line", () => {
    render(
      <SparseSeriesChart
        series={[{ label: "Created", series: sparse, colorVar: "--chart-1" }]}
        windowFrom={sparse.windowFrom}
        windowTo={sparse.windowTo}
      />,
    );
    // Feb–Mar and Jun–Jul are two runs. A single polyline through all four would interpolate April
    // and May, which nobody measured.
    const segments = screen.getAllByTestId("sparse-series-segment");
    expect(segments).toHaveLength(2);
    // And each segment carries exactly its own two points, so the break is real rather than a
    // second polyline drawn over the same span.
    for (const segment of segments) {
      expect(segment.getAttribute("points")?.trim().split(/\s+/)).toHaveLength(2);
    }
  });

  it("an isolated observation is a dot with no line, because its neighbours are unknown", () => {
    const isolated = series([
      ["2026-02-01T00:00:00Z", 2],
      ["2026-06-01T00:00:00Z", 1],
    ]);
    render(
      <SparseSeriesChart
        series={[{ label: "Created", series: isolated, colorVar: "--chart-1" }]}
        windowFrom={isolated.windowFrom}
        windowTo={isolated.windowTo}
      />,
    );
    expect(screen.getAllByTestId("sparse-series-point")).toHaveLength(2);
    expect(screen.queryAllByTestId("sparse-series-segment")).toHaveLength(0);
  });

  it("says in the text alternative that unlisted periods were not measured as zero", () => {
    render(
      <SparseSeriesChart
        series={[{ label: "Created", series: sparse, colorVar: "--chart-1" }]}
        windowFrom={sparse.windowFrom}
        windowTo={sparse.windowTo}
      />,
    );
    const readout = screen.getByTestId("sparse-series-readout");
    expect(readout.textContent).toMatch(/were not measured as zero/i);
    expect(readout.textContent).toContain("2026-02");
    expect(readout.textContent).not.toContain("2026-04");
  });

  it("a never-observed series renders no points at all rather than a flat line of zeroes", () => {
    const empty = series([]);
    render(
      <SparseSeriesChart
        series={[{ label: "Cancelled", series: empty, colorVar: "--chart-2" }]}
        windowFrom={empty.windowFrom}
        windowTo={empty.windowTo}
      />,
    );
    expect(screen.queryAllByTestId("sparse-series-point")).toHaveLength(0);
    expect(screen.queryAllByTestId("sparse-series-segment")).toHaveLength(0);
    expect(screen.getByTestId("sparse-series-readout").textContent).toMatch(/never been observed/i);
  });

  it("the analytics adapter and model coalesce nothing to zero", () => {
    // The one edit that would undo all of the above in a single character, made in a file with no
    // rendering to review. `?? 0` on `MeterRollup.total` turns "no tenant could be counted" into
    // "the fleet is running none", and `?? 0` in the series mapper is the back-fill itself.
    for (const file of [
      "lib/adapters/platform-analytics.adapter.ts",
      "lib/models/platform-analytics.model.ts",
    ]) {
      const source = stripComments(readFileSync(resolve(FRONTEND_ROOT, file), "utf8"));
      expect(source, `${file} must not coalesce an absence to a number`).not.toMatch(/\?\?\s*0\b/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 3 — a status is never green out of ignorance
// ─────────────────────────────────────────────────────────────────────────────

describe("only a component that answered may render as healthy", () => {
  it("UP is the only state that may render green", () => {
    expect(HEALTH_STATE_BADGE.UP.variant).toBe("success");
    for (const state of ["DOWN", "UNREACHABLE", "UNKNOWN"] as const) {
      expect(HEALTH_STATE_BADGE[state].variant, `${state} must not be green`).not.toBe("success");
    }
  });

  it("UNREACHABLE and UNKNOWN keep separate badges from DOWN and from each other", () => {
    // Four states, four renderings. Collapsing any pair loses the difference between "that service
    // is broken" and "I cannot see that service", which call for different actions at 3am.
    const variants = new Set(Object.values(HEALTH_STATE_BADGE).map((b) => b.variant));
    const labels = new Set(Object.values(HEALTH_STATE_BADGE).map((b) => b.label));
    expect(variants.size).toBe(4);
    expect(labels.size).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A meter that cannot be read cannot be rendered as a number
// ─────────────────────────────────────────────────────────────────────────────

describe("a usage roll-up nobody could count refuses to become a figure", () => {
  const base: MeterRollup = {
    resource: "branches",
    unit: "branches",
    total: 412,
    limitTotal: 900,
    tenantsCounted: 9,
    tenantsNotMetered: 0,
    tenantsUnreadable: 0,
    complete: true,
    source: "user-service live count",
  };

  it("a counted dimension with a ceiling renders as a figure", () => {
    expect(meterUnavailableReason(base)).toBeNull();
  });

  it("a dimension no tenant answered for states the outage, not a zero", () => {
    const reason = meterUnavailableReason({
      ...base,
      total: null,
      tenantsCounted: 0,
      tenantsUnreadable: 9,
      complete: false,
    });
    expect(reason).toMatch(/did not answer|answered/i);
  });

  it("a dimension with no ceiling refuses to draw a bar against zero", () => {
    // A meter against a zero denominator either divides by zero or renders a full bar, and a full
    // bar means "at capacity" — the opposite of what an absent ceiling means.
    const reason = meterUnavailableReason({ ...base, limitTotal: 0 });
    expect(reason).toMatch(/no tier ceiling is recorded/i);
  });
});
