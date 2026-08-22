import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { StationPicker } from "@/components/kds/station-picker";
import { StationBoard } from "@/components/kds/station-board";
import { ELAPSED_URGENCY_BOUND_MS } from "@/lib/format/elapsed";

/**
 * 38-05 task 3 — **the live lie.** `Oldest 113h 52m`, in the same red as a ticket four minutes late.
 *
 * <h3>What was actually wrong, and why the number was the smaller half of it</h3>
 *
 * `station-picker.tsx` grew its own unbounded formatter (minutes → hours, forever) and styled the
 * result through `getAgingState` alone. Against a 15-minute escalation threshold EVERY ticket over
 * fifteen minutes old is `late`, so a check fired on 2026-08-07 rendered `Oldest 113h 52m` in
 * `--kds-late`, bold, with the same icon and the same weight as a check that is genuinely three
 * minutes past its target. The audit photographed exactly that on both station cards
 * (`evidence/shots/kitchen-index-desktop-light.png`).
 *
 * A cook cannot convert 113 hours into "the Friday before last" while plating — that is the
 * legibility half. The half that costs money is the other one: a board that shouts in its urgent
 * colour about four-day-old data teaches the people reading it that the urgent colour does not mean
 * urgent, and the ticket that IS four minutes late then reads as more of the same. Bounding the
 * number is how the colour keeps its meaning.
 *
 * <h3>Why this asserts on the SURFACE, not on the formatter</h3>
 *
 * `__tests__/lib/format/elapsed.test.ts` already proves the boundary arithmetic 35 ways. It would
 * have passed against the broken picker too, because the picker never called it. These tests render
 * the REAL `StationPicker` against a real ticket payload and read the string a cook reads plus the
 * treatment wrapped around it, which is the only place the two can be shown to agree.
 *
 * <h3>Falsification</h3>
 *
 * Every assertion is written against `station-oldest-*`, a `data-testid` that predates this fix, so
 * a pre-fix run fails on the CONTENT rather than on a missing element. Against the old component
 * the 24h01m case renders `Oldest 24h 1m` with `text-kds-late font-bold` and fails on the very
 * first assertion of each of the two boundary tests.
 */

const BRANCH = "b1000001-0000-4000-8000-000000000001";

/**
 * One fixed `now` for the whole file, and the clock is mocked to it.
 *
 * Never `Date.now()`: `__tests__/kds/kds-clear-stale.test.tsx` hardcoded an instant, and it has
 * been red since the world moved past it. Every instant below is derived from this constant, so
 * there is no second one to drift.
 */
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 3_600_000;

vi.mock("@/lib/hooks/kds/use-kds-clock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks/kds/use-kds-clock")>();
  return { ...actual, useKdsClock: () => NOW };
});

vi.mock("@/lib/hooks/kds/use-kds-socket", () => ({
  useKdsSocket: () => ({ isConnected: true }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const HOTLINE = {
  id: "51000001-0000-4000-8000-000000000001",
  branchId: BRANCH,
  code: "HOTLINE",
  name: "Hot line",
  active: true,
  // 15 minutes — the default, and the reason an unbounded age was ALWAYS `late`.
  escalationThresholdSeconds: 900,
};
/** A second station, so the picker renders its grid instead of auto-navigating (KDS-04). */
const PASS = { ...HOTLINE, id: "51000001-0000-4000-8000-000000000002", code: "PASS", name: "Pass" };

function ticketAgedMs(ageMs: number) {
  return {
    id: "51000001-0000-4000-8000-000000000009",
    orderId: "52000001-0000-4000-8000-000000000009",
    orderNo: "ORD-009",
    stationCode: "HOTLINE",
    status: "PENDING",
    priority: false,
    receivedAt: new Date(NOW - ageMs).toISOString(),
    startedAt: null,
    readyAt: null,
    orderNotes: null,
    tableNumber: "12",
    orderType: "DINE_IN",
    items: [
      {
        id: "53000001-0000-4000-8000-000000000009",
        orderItemId: "54000001-0000-4000-8000-000000000009",
        name: "Lamb chops",
        qty: 1,
        modifiers: [],
        notes: null,
        status: "PENDING",
        revisionNo: 1,
        firedAt: null,
      },
    ],
  };
}

function serveAged(ageMs: number) {
  const content = [ticketAgedMs(ageMs)];
  server.use(
    http.get("*/api/v1/kitchen/kds/stations", () => HttpResponse.json([HOTLINE, PASS])),
    http.get("*/api/v1/kitchen/kds/tickets", () =>
      HttpResponse.json({
        content,
        totalElements: content.length,
        totalPages: 1,
        number: 0,
        size: 500,
      }),
    ),
  );
}

async function renderPickerAged(ageMs: number) {
  seedSession({ permissions: ["pos.kds.view", "pos.kds.update"] });
  serveAged(ageMs);
  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <StationPicker branchId={BRANCH} />
    </Wrapper>,
  );
  return waitFor(() => screen.getByTestId("station-oldest-HOTLINE"));
}

/** The same `Intl` answer the module gives, derived here rather than hardcoded per runner zone. */
function dayAndMonth(atMs: number): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    new Date(atMs),
  );
}

afterEach(() => {
  clearSession();
});

describe("38-05 task 3 — the station tile's oldest-ticket age is bounded at 24h", () => {
  it("counts, and shouts, right up to the bound: 23h 59m is live work", async () => {
    const age = 23 * HOUR + 59 * MINUTE;
    const line = await renderPickerAged(age);

    // The DURATION, because below the bound "how long has this been here" is the question.
    expect(line).toHaveTextContent("Oldest 23h 59m");
    expect(line).toHaveAttribute("data-within-urgency-window", "true");
    // Urgency INTACT — at 23h against a 15-minute threshold this is late, and must look it.
    expect(line.className).toContain("text-kds-late");
    expect(line.className).toContain("font-bold");
  });

  it("stops counting one minute past the bound and names the day instead", async () => {
    const age = 24 * HOUR + 1 * MINUTE;
    const line = await renderPickerAged(age);

    expect(line).toHaveTextContent(`Oldest from ${dayAndMonth(NOW - age)}`);
    // Not a duration in any form. `24h 1m`, `1d`, `1441m` all fail here.
    expect(line.textContent).not.toMatch(/\d+\s*(h|m|d)\b/);
    expect(line).toHaveAttribute("data-within-urgency-window", "false");
  });

  it("113h — the figure the audit photographed — renders a date and NO urgency treatment", async () => {
    const age = 113 * HOUR + 52 * MINUTE;
    const line = await renderPickerAged(age);

    expect(line).toHaveTextContent(`Oldest from ${dayAndMonth(NOW - age)}`);
    expect(line).not.toHaveTextContent("113h");
    expect(line).toHaveAttribute("data-within-urgency-window", "false");

    // The urgency treatment is WITHDRAWN, not softened: no late hue, no warn hue, no bold.
    expect(line.className).toContain("text-kds-muted");
    expect(line.className).not.toContain("text-kds-late");
    expect(line.className).not.toContain("text-kds-warn");
    expect(line.className).not.toContain("font-bold");
  });

  it("carries the change on shape and word as well as hue (§4.2, D-38-13)", async () => {
    const stale = await renderPickerAged(ELAPSED_URGENCY_BOUND_MS + MINUTE);
    // CHANNEL — the word. Provenance, not a countdown.
    expect(stale).toHaveTextContent("Oldest from");
    // CHANNEL — the icon SHAPE. `Flame` is what the board's late state uses; a stale reading
    // must not borrow it, and `lucide` stamps the glyph name onto the svg's class list.
    const staleIcon = stale.querySelector("svg");
    expect(staleIcon?.getAttribute("class")).toContain("lucide-calendar-clock");
    expect(staleIcon?.getAttribute("class")).not.toContain("lucide-flame");
    // CHANNEL — assistive tech hears words, never `07:42`, which is announced as a clock time.
    expect(stale.getAttribute("aria-label")).toMatch(/older than a day/i);

    clearSession();
    document.body.innerHTML = "";

    const live = await renderPickerAged(30 * MINUTE);
    expect(live).toHaveTextContent("Oldest 30:0");
    expect(live.querySelector("svg")?.getAttribute("class")).toContain("lucide-flame");
  });
});

describe("38-05 task 2 — the board stops fighting the shell", () => {
  it("the board root is its container's height, never a viewport minimum", async () => {
    seedSession({ permissions: ["pos.kds.view", "pos.kds.update"] });
    serveAged(5 * MINUTE);
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <StationBoard branchId={BRANCH} stationCode="HOTLINE" />
      </Wrapper>,
    );
    const board = await waitFor(() => screen.getByTestId("kds-board"));

    /*
     * `min-h-screen` inside the tenant shell is 100vh asked of an element whose container is
     * already the viewport LESS the top bar — so the shell grows an outer scrollbar and the
     * board's own column scroll region stops being the thing that scrolls. A class-string
     * assertion is a weak instrument in general; here it is the right one, because the defect
     * IS the class and jsdom computes no layout to measure instead.
     */
    expect(board.className).not.toContain("min-h-screen");
    expect(board.className).toContain("h-full");
    expect(board.className).toContain("min-h-0");
  });
});
