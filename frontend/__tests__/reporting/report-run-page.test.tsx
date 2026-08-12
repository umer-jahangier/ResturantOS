import { describe, it, expect, afterEach, vi } from "vitest";
import { Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import ReportRunPage from "@/app/(tenant)/app/reports/[code]/page";

/**
 * F15 — `/app/reports/<a code that does not exist>`.
 *
 * The walkthrough (§3 #20) drove `/app/reports/audit` as the owner and photographed
 * *"← All reports / audit / From To"*: a heading typed out of the URL segment and an operable
 * date-range form for a report that has never existed. Underneath, the run request answered
 * 404 twice and the reader was told nothing, because `ReportTable` renders `null` for an
 * undefined result and so cannot tell a failed request from a report that has not run.
 *
 * Every assertion below is on what the reader SEES — the heading text, whether a date field is
 * operable, whether the words "doesn't exist" are on screen — never on a prop or a hook's
 * `enabled` flag, because the defect was invisible precisely at that layer.
 *
 * The three states are kept apart deliberately, and the catalog-outage case matters most: an
 * owner whose reporting-service is down must NOT be told their report does not exist.
 */

const BRANCH = "b0000001-0000-4000-8000-000000000001";

/**
 * The page reads its route params with React's `use()`. Next.js hands it an ALREADY-SETTLED
 * thenable (`status: "fulfilled"`), which `use` unwraps synchronously; a bare `Promise.resolve`
 * suspends forever under jsdom because nothing pings the root when it settles. So the test
 * hands over the same shape the framework does.
 */
function settledParams<T>(value: T): Promise<T> {
  const thenable = Promise.resolve(value) as Promise<T> & { status: string; value: T };
  thenable.status = "fulfilled";
  thenable.value = value;
  return thenable;
}

function renderReport(code: string, permissions: string[] = ["reporting.report.view"]) {
  seedSession({ permissions, branchId: BRANCH });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <Suspense fallback={<div>loading route</div>}>
        <ReportRunPage params={settledParams({ code })} />
      </Suspense>
    </Wrapper>,
  );
}

describe("/app/reports/[code]", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("says the report does not exist, and offers the way back, for a code the catalog has never heard of", async () => {
    renderReport("definitely-not-a-report");

    expect(await screen.findByTestId("report-not-found")).toBeInTheDocument();
    expect(screen.getByText(/This report doesn't exist/i)).toBeInTheDocument();
    // The code is quoted as evidence, in a sentence — never dressed up as the report's title.
    expect(
      screen.getByText(/No report is registered under the code "definitely-not-a-report"/),
    ).toBeInTheDocument();

    const back = screen.getByRole("link", { name: /back to all reports/i });
    expect(back).toHaveAttribute("href", "/app/reports");
  });

  it("does not render a title made from the URL for an unknown code", async () => {
    renderReport("definitely-not-a-report");
    await screen.findByTestId("report-not-found");

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Report not found");
    expect(heading).not.toHaveTextContent("definitely-not-a-report");
  });

  it("does not offer a date-range form to run a report that does not exist", async () => {
    renderReport("definitely-not-a-report");
    await screen.findByTestId("report-not-found");

    expect(screen.queryByLabelText("Report period from")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Report period to")).not.toBeInTheDocument();
  });

  it("never asks reporting-service to run a report the catalog does not list", async () => {
    const attempted: string[] = [];
    let catalogServed = false;
    server.use(
      http.post("*/api/v1/reporting/reports/:code/run", ({ params }) => {
        attempted.push(params.code as string);
        return HttpResponse.json(
          { error: { code: "NOT_FOUND", message: "Unknown report code", details: [] } },
          { status: 404 },
        );
      }),
    );
    server.events.on("response:mocked", ({ request }) => {
      if (request.method === "GET" && request.url.includes("/reporting/reports"))
        catalogServed = true;
    });

    renderReport("definitely-not-a-report");
    // Wait for the catalog to have answered — the only point after which a run request could
    // legitimately have been made — then leave room for it (and React Query's retry) to land.
    await waitFor(() => expect(catalogServed).toBe(true));
    await new Promise((r) => setTimeout(r, 300));

    expect(attempted).toEqual([]);
  });

  it("says the CATALOG failed — not that the report is missing — when reporting-service is down", async () => {
    server.use(
      http.get("*/api/v1/reporting/reports", () =>
        HttpResponse.json(
          { error: { code: "SERVICE_UNAVAILABLE", message: "reporting is down", details: [] } },
          { status: 503 },
        ),
      ),
    );

    renderReport("sales-by-day");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/report catalog/i);
    expect(screen.queryByTestId("report-not-found")).not.toBeInTheDocument();
    expect(screen.queryByText(/This report doesn't exist/i)).not.toBeInTheDocument();
  });

  it("still renders a real report's title, period form and rows", async () => {
    renderReport("sales-by-day");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Sales by Day" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Report period from")).toBeInTheDocument();
    expect(screen.getByLabelText("Report period to")).toBeInTheDocument();

    // Real rows from the catalogued report, not an empty shell.
    await waitFor(() => expect(screen.getByText("2026-07-15")).toBeInTheDocument());
    expect(screen.getByText("Rs 5,350.00")).toBeInTheDocument();
    expect(screen.queryByTestId("report-not-found")).not.toBeInTheDocument();
  });

  it("announces a run that fails instead of leaving the report area blank", async () => {
    server.use(
      http.post("*/api/v1/reporting/reports/sales-by-day/run", () =>
        HttpResponse.json(
          { error: { code: "SERVICE_UNAVAILABLE", message: "reporting is down", details: [] } },
          { status: 503 },
        ),
      ),
    );

    renderReport("sales-by-day");

    await screen.findByRole("heading", { level: 1, name: "Sales by Day" });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Sales by Day/i);
    expect(screen.queryByTestId("report-not-found")).not.toBeInTheDocument();
  });
});
