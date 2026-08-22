import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "@/lib/models/audit.model";

/**
 * The audit digest (N7) — the compact five-row block, and its wired half.
 *
 * <h2>What is asserted, and why in this order</h2>
 *
 * <p>`AuditDigest` takes plain props, so most of this file needs no server at all: a fixed clock,
 * a handful of rows, and assertions on the sentence a person reads. That is the point of the
 * split — the full log (`audit-log.tsx`) cannot be rendered anywhere without a query client, and
 * the thing this replaces on the demo's admin screen is a block, not a screen.
 *
 * <p>The last two tests drive the connected half, because the one property a digest of an
 * append-only compliance record must have cannot be tested from props: a failed read must never
 * render as "nothing has happened".
 */

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  getPaginated: vi.fn(),
}));

vi.mock("@/lib/api-client/request", () => ({
  get: (...args: unknown[]) => transport.get(...args),
  getPaginated: (...args: unknown[]) => transport.getPaginated(...args),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/hooks/auth/use-current-user", () => ({
  useCurrentUser: () => ({
    isAuthenticated: true,
    userId: "61334688-6b5c-4926-ac82-e93208ba5324",
    branchId: "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03",
    roles: ["OWNER"],
    permissions: ["audit.log.view"],
    attributes: {},
  }),
}));

import { AuditDigest } from "@/components/audit/audit-digest";
import { RecentAuditDigest } from "@/components/audit/recent-audit-digest";

const BRANCH = {
  id: "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03",
  tenantId: "9f2b1c40-7a55-4c1e-9c3e-5b7c1d2e3f40",
  name: "Floating Terrace",
  isHq: true,
  isActive: true,
  timezone: "Asia/Karachi",
};

/**
 * One clock, stated. Nothing in the component reads `Date.now()`, which is what makes these
 * assertions durable — this repo already carries one test that hardcoded a date and went red
 * when the world moved on.
 */
const NOW = new Date("2026-08-21T09:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function at(msAgo: number): Date {
  return new Date(NOW.getTime() - msAgo);
}

function event(overrides: Partial<AuditEvent> & Pick<AuditEvent, "id" | "action">): AuditEvent {
  return {
    occurredAt: at(7 * MINUTE),
    resourceType: null,
    resourceId: null,
    branchId: BRANCH.id,
    actorId: "bc0d9897-e0ef-40de-b404-89ce044ab2cb",
    actorName: "Shift Cashier 984155",
    impersonatorId: null,
    impersonatorName: null,
    reason: null,
    details: {},
    detailsUnreadable: false,
    ...overrides,
  };
}

const VOID = event({
  id: 8790,
  action: "ORDER_VOIDED",
  resourceType: "ORDER",
  resourceId: "f4ec7d5b-9b14-4aba-8b68-cfa44a41a3f1",
  reason: "End of shift — parked check never taken",
  occurredAt: at(7 * MINUTE),
});

const TILL_CLOSED = event({
  id: 8791,
  action: "TILL_CLOSED",
  resourceType: "TILL",
  actorName: "Ayesha Khan",
  occurredAt: at(3 * HOUR + 20 * MINUTE),
});

const ROLE_GRANTED = event({
  id: 8792,
  action: "ROLE_GRANTED",
  resourceType: "ROLE",
  actorName: "Owner",
  occurredAt: at(5 * DAY),
});

const OLD_JOURNAL = event({
  id: 8793,
  action: "JOURNAL_POSTED",
  resourceType: "JOURNAL",
  actorName: "Book Keeper",
  occurredAt: at(45 * DAY),
});

/** The adapter turns an unparseable instant into the epoch so a screen can refuse to render it. */
const UNDATED = event({
  id: 8794,
  action: "USER_LOGIN_SUCCEEDED",
  resourceType: "USER",
  actorName: "owner@terrace.local",
  occurredAt: new Date(0),
});

const IMPERSONATED = event({
  id: 8795,
  action: "USER_CREATED",
  resourceType: "USER",
  actorName: "Floating Terrace Owner",
  impersonatorId: "0f5b3d2a-1111-4c1e-9c3e-5b7c1d2e3f40",
  impersonatorName: "Platform Support",
  occurredAt: at(30 * MINUTE),
});

const SPARE = event({ id: 8796, action: "TILL_OPENED", resourceType: "TILL" });

function renderDigest(events: AuditEvent[], props: Record<string, unknown> = {}) {
  return render(
    <AuditDigest
      events={events}
      now={NOW}
      timeZone="Asia/Karachi"
      href="/app/settings/audit"
      {...props}
    />,
  );
}

/**
 * The first feed row, asserted rather than indexed.
 *
 * <p>`getAllByRole(...)[0]` is `HTMLElement | undefined` under `noUncheckedIndexedAccess`, and a
 * `!` here would turn "the digest rendered nothing" into a null-pointer stack trace three lines
 * later instead of a sentence naming what went wrong.
 */
function firstRow(scope: HTMLElement | null = null): HTMLElement {
  const [row] = scope ? within(scope).getAllByRole("listitem") : screen.getAllByRole("listitem");
  if (!row) throw new Error("the digest rendered no rows");
  return row;
}

function renderConnected() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <RecentAuditDigest />
    </QueryClientProvider>,
  );
}

describe("the audit digest reads as a summary, not as the record", () => {
  it("shows five rows of event · actor · time and links out to the full log", () => {
    renderDigest([VOID, TILL_CLOSED, ROLE_GRANTED, OLD_JOURNAL, UNDATED, IMPERSONATED, SPARE]);

    const digest = screen.getByTestId("audit-digest");
    expect(within(digest).getAllByRole("listitem")).toHaveLength(5);

    // The demo's row: what happened, who did it, when. The reason is carried too — it is the one
    // thing an owner scanning a void actually wants, and the full log is two clicks away.
    const first = firstRow(digest);
    expect(within(first).getByText("Order voided")).toBeInTheDocument();
    expect(first).toHaveTextContent("Shift Cashier 984155");
    expect(first).toHaveTextContent("End of shift — parked check never taken");
    expect(within(first).getByText("7 min ago")).toBeInTheDocument();

    expect(within(digest).getByTestId("audit-digest-full-log")).toHaveAttribute(
      "href",
      "/app/settings/audit",
    );
    // A five-row window on an append-only record must never be mistakable for the record.
    expect(within(digest).getByTestId("audit-digest-caption")).toHaveTextContent(
      /this is a summary, not the record/i,
    );
  });

  it("prints the tone word visibly, not to screen readers only", () => {
    const { container } = renderDigest([VOID, TILL_CLOSED]);

    const words = Array.from(container.querySelectorAll('[data-slot="activity-tone"]'));
    expect(words.map((w) => w.textContent)).toEqual(["Order", "Till"]);
    // `activity-row.tsx` states this as a contract: a tone's word is the channel that survives
    // greyscale, so it is rendered in the row and never hidden behind `sr-only`.
    for (const word of words) {
      expect(word.className).not.toContain("sr-only");
      expect(word).toBeVisible();
    }
  });

  it("stops counting past the bound and names the day instead of saying “45d ago”", () => {
    renderDigest([OLD_JOURNAL]);

    const row = firstRow();
    // `lib/format/elapsed.ts` returns a DATE past 30 days, and "7 Jul 2026 ago" is not a thing
    // anybody writes. The bound is read from the module that owns it, not re-checked here.
    expect(within(row).getByText("7 Jul 2026")).toBeInTheDocument();
    expect(row).not.toHaveTextContent(/ago/);
  });

  it("renders an unusable instant as an absence rather than as 56 years ago", () => {
    renderDigest([UNDATED]);

    const row = firstRow();
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(row).not.toHaveTextContent(/1970|56 years/);
  });

  it("never collapses an impersonation into the account that was acted as", () => {
    renderDigest([IMPERSONATED]);

    const row = firstRow();
    expect(row).toHaveTextContent("Floating Terrace Owner");
    // D-34 recorded every user as their own impersonator. The account acted AS is not the human
    // who acted, and the digest uses the full log's own words so the two cannot disagree.
    expect(row).toHaveTextContent(/acting as this account: Platform Support/);
  });

  it("does not render the demo's Last Active or 2FA columns, which have no backing data", () => {
    renderDigest([VOID, TILL_CLOSED, ROLE_GRANTED]);

    // APP-DASHBOARD-AUDIT §6.2: there is no last-seen timestamp on a user record and no per-user
    // MFA flag this screen can read. D-38-16 makes an uncomputable value an absence — and the
    // honest absence for a column that does not exist is not to draw the column.
    expect(screen.queryByText(/last active/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/2fa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^(on|off)$/i)).not.toBeInTheDocument();
  });

  it("says its window is empty without claiming nothing happened", () => {
    renderDigest([]);

    expect(screen.getByText(/no events recorded in this window/i)).toBeInTheDocument();
    // The heading and the way out stay on screen: an empty digest whose link disappeared would
    // strand the one reader who most needs the full record.
    expect(screen.getByTestId("audit-digest-full-log")).toBeInTheDocument();
  });
});

describe("the wired digest", () => {
  beforeEach(() => {
    transport.get.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/branches/")) return Promise.resolve(BRANCH);
      throw new Error(`unexpected GET ${url}`);
    });
    transport.getPaginated.mockResolvedValue({
      data: [
        {
          id: 8790,
          occurredAt: "2026-08-12T03:16:13.304953Z",
          action: "ORDER_VOIDED",
          resourceType: "ORDER",
          resourceId: "f4ec7d5b-9b14-4aba-8b68-cfa44a41a3f1",
          branchId: BRANCH.id,
          userId: "bc0d9897-e0ef-40de-b404-89ce044ab2cb",
          userName: "Shift Cashier 984155",
          impersonatedBy: null,
          impersonatedByName: null,
          afterState: JSON.stringify({ reason: "Parked check never taken" }),
          metadata: null,
        },
      ],
      meta: { page: { cursor: "0", nextCursor: null, limit: 5 }, totalCount: 3457 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("asks for five rows and renders them through the real schema and adapter", async () => {
    renderConnected();

    expect(await screen.findByText("Order voided")).toBeInTheDocument();
    expect(screen.getByText(/Parked check never taken/)).toBeInTheDocument();
    expect(transport.getPaginated).toHaveBeenCalledWith(
      "/api/v1/audit/events",
      expect.objectContaining({ size: 5, page: 0, zone: "Asia/Karachi" }),
    );
  });

  it("renders a failed read as a failure, never as “no events recorded”", async () => {
    transport.getPaginated.mockRejectedValue(
      Object.assign(new Error("Service unavailable"), { status: 503 }),
    );
    renderConnected();

    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
    // The whole reason this component goes through `QueryBoundary`: "nothing has happened" shown
    // to someone whose audit service is down is the exact inverse of what the record is for.
    expect(screen.queryByText(/no events recorded/i)).not.toBeInTheDocument();
  });
});
