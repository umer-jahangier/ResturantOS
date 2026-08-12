import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { PrinterRegistryForm } from "@/components/settings/printer-registry-form";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

/**
 * S8 — choosing the USB printer, and being told when a station has stopped printing.
 *
 * <h2>What these assert, and why it is the user-visible thing</h2>
 *
 * <p>F8 proved a live agent puts real bytes on a real printer. What it left is what this file
 * pins: on /app/settings/printers the USB/system printer was a FREE-TEXT box with somebody else's
 * printer model as its placeholder (`<input id="queue-…" placeholder="TM_T88VI">`, measured on
 * 2026-08-12), so configuring the till printer meant knowing its exact CUPS destination and typing
 * it without a typo — and a typo produces no error on this screen, no error on save, and no paper.
 *
 * <p>And when a configured printer stopped answering, nothing anywhere said so: the agent read
 * "Connected" because the MACHINE was polling, and the unrouted-stations alert stayed silent
 * because the station DID have a printer.
 *
 * <p>Every assertion below is what the operator sees — the control's tag, its options, the sentence
 * in the alert — never a prop and never a class name.
 */

const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const TENANT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";

function printer(over: Record<string, unknown> = {}) {
  return {
    id: "till-receipt",
    terminalId: null,
    role: "RECEIPT",
    stationCode: null,
    transport: "SYSTEM",
    host: null,
    port: null,
    systemPrinterName: null,
    widthMm: 80,
    columns: 42,
    columnsMeasured: false,
    codepage: "CP437",
    cut: "PARTIAL",
    drawerPin: null,
    drawerPulseMs: null,
    ...over,
  };
}

function mockConfig(printers: unknown[], unroutedStations: string[] = []) {
  server.use(
    http.get("*/api/v1/branches/*/receipt-config", () =>
      HttpResponse.json({
        data: {
          config: {
            agent: { baseUrl: "http://127.0.0.1:7654", lanUrl: null },
            printers,
            header: null,
            footer: null,
            fbr: null,
            kitchenStations: ["GRILL"],
          },
          completeness: { complete: true, unroutedStations, warnings: [] },
        },
        meta: null,
        warnings: [],
      }),
    ),
  );
}

function mockAgents(agents: unknown[]) {
  server.use(
    http.get("*/api/v1/pos/print-agents", () =>
      HttpResponse.json({ data: agents, meta: null, warnings: [] }),
    ),
  );
}

function mockHealth(printers: unknown[]) {
  server.use(
    http.get("*/api/v1/pos/printers/health", () =>
      HttpResponse.json({ data: { windowHours: 24, printers }, meta: null, warnings: [] }),
    ),
  );
}

function mockStations() {
  server.use(
    http.get("*/api/v1/pos/stations", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
  );
}

const CONNECTED_AGENT_WITH_TWO_QUEUES = {
  agentId: "11111111-1111-4111-8111-111111111111",
  branchId: BRANCH,
  label: "Counter till",
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  revokedAt: null,
  lastSeenAt: new Date().toISOString(),
  devices: [
    {
      name: "STMicroelectronics_POS80_Printer_USB",
      description: "STMicroelectronics POS80 Printer USB",
      state: "IDLE",
      isDefault: true,
    },
    { name: "_80Series2", description: "80Series2", state: "IDLE", isDefault: false },
  ],
  devicesUnavailable: null,
  devicesReportedAt: new Date().toISOString(),
};

function renderForm() {
  seedSession({ permissions: ["pos.printers.admin"], branchId: BRANCH, tenantId: TENANT });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <PrinterRegistryForm branchId={BRANCH} />
    </Wrapper>,
  );
}

describe("choosing the USB printer on the Printers screen", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("offers the queues the agent found as a LIST, not a box to type into", async () => {
    mockStations();
    mockConfig([printer()]);
    mockAgents([CONNECTED_AGENT_WITH_TWO_QUEUES]);
    mockHealth([]);
    renderForm();

    const picker = await screen.findByLabelText(/printer on the machine/i);
    // The whole point. An <input> here is the defect: a typo in a queue name is invisible until a
    // customer is waiting for a receipt that will never print.
    expect(picker.tagName).toBe("SELECT");

    const values = Array.from((picker as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toContain("STMicroelectronics_POS80_Printer_USB");
    expect(values).toContain("_80Series2");

    // The machine that saw it is named on every option, because a branch has more than one till
    // and the manager has to know which one to walk to.
    expect(
      within(picker as HTMLSelectElement).getAllByText(/on Counter till/i),
    ).toHaveLength(2);
  });

  it("stores the queue NAME, never the human description", async () => {
    const user = userEvent.setup();
    mockStations();
    mockConfig([printer()]);
    mockAgents([CONNECTED_AGENT_WITH_TWO_QUEUES]);
    mockHealth([]);
    renderForm();

    const picker = (await screen.findByLabelText(/printer on the machine/i)) as HTMLSelectElement;
    await user.selectOptions(picker, "STMicroelectronics_POS80_Printer_USB");

    // `lp -d` takes the destination, not the prose. Storing the label would produce a
    // configuration that reads correctly on screen and fails at the spooler.
    expect(picker.value).toBe("STMicroelectronics_POS80_Printer_USB");
  });

  it("refuses to save a USB printer with nothing chosen, and names the field", async () => {
    mockStations();
    mockConfig([printer({ systemPrinterName: null })]);
    mockAgents([CONNECTED_AGENT_WITH_TWO_QUEUES]);
    mockHealth([]);
    renderForm();

    await screen.findByLabelText(/printer on the machine/i);
    expect(await screen.findByTestId("save-printers")).toBeDisabled();
    expect(
      screen.getByText(/Choose which printer on the machine this is/i),
    ).toBeInTheDocument();
  });

  it("says WHY there is nothing to choose from, rather than showing an empty dropdown", async () => {
    mockStations();
    mockConfig([printer()]);
    mockAgents([
      {
        ...CONNECTED_AGENT_WITH_TWO_QUEUES,
        devices: [],
        devicesUnavailable:
          "This agent is running on Windows, where it cannot send raw ESC/POS to a print queue.",
      },
    ]);
    mockHealth([]);
    renderForm();

    const reason = await screen.findByTestId("no-devices-reason");
    // An empty dropdown reads as "your printer does not exist". The reason is the difference
    // between a manager who plugs the printer in and one who buys a new one.
    expect(reason.textContent).toMatch(/Windows/);
  });

  it("keeps a saved queue that no agent is reporting right now, and marks it", async () => {
    mockStations();
    mockConfig([printer({ systemPrinterName: "TILL_IN_THE_OTHER_ROOM" })]);
    mockAgents([{ ...CONNECTED_AGENT_WITH_TWO_QUEUES, devices: [] }]);
    mockHealth([]);
    renderForm();

    const picker = (await screen.findByLabelText(/printer on the machine/i)) as HTMLSelectElement;
    expect(picker.value).toBe("TILL_IN_THE_OTHER_ROOM");
    expect(
      within(picker).getByText(/not reported by any agent right now/i),
    ).toBeInTheDocument();
    // A form that silently erased a working configuration because a till is asleep would be a new
    // instance of the defect it was built to fix.
    expect(screen.queryByTestId("save-blocked")).toBeNull();
  });
});

describe("a station whose printer has stopped answering", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  const GRILL = printer({
    id: "grill-9102",
    role: "KITCHEN",
    stationCode: "GRILL",
    transport: "TCP",
    host: "127.0.0.1",
    port: 9102,
    systemPrinterName: null,
  });

  it("says the STATION cannot print, and quotes the transport's own error", async () => {
    mockStations();
    mockConfig([GRILL]);
    mockAgents([CONNECTED_AGENT_WITH_TWO_QUEUES]);
    mockHealth([
      {
        printerId: "grill-9102",
        state: "FAILING",
        waiting: 2,
        printed: 0,
        failed: 3,
        lastAttemptAt: new Date().toISOString(),
        lastPrintedAt: null,
        lastError: "connect ECONNREFUSED 127.0.0.1:9102",
      },
    ]);
    renderForm();

    const alert = await screen.findByTestId("printers-failing");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toMatch(/GRILL cannot print/);
    // The transport's own words. "Printing failed" tells whoever walks to the kitchen nothing.
    expect(alert.textContent).toMatch(/connect ECONNREFUSED 127\.0\.0\.1:9102/);
    expect(alert.textContent).toMatch(/2 jobs are still waiting/);
  });

  it("does not accuse a printer that is working", async () => {
    mockStations();
    mockConfig([GRILL]);
    mockAgents([CONNECTED_AGENT_WITH_TWO_QUEUES]);
    mockHealth([
      {
        printerId: "grill-9102",
        state: "PRINTING",
        waiting: 0,
        printed: 4,
        failed: 1,
        lastAttemptAt: new Date().toISOString(),
        lastPrintedAt: new Date().toISOString(),
        lastError: null,
      },
    ]);
    renderForm();

    await screen.findByTestId("printer-list");
    await waitFor(() =>
      expect(screen.getByTestId("printer-delivery")).toHaveAttribute(
        "data-delivery-state",
        "PRINTING",
      ),
    );
    // One failure an hour ago, four successes since. A screen that reported this as broken would
    // be ignored within a week, and then the real failure would be ignored with it.
    expect(screen.queryByTestId("printers-failing")).toBeNull();
  });

  it("says the health read FAILED rather than implying every printer is fine", async () => {
    mockStations();
    mockConfig([GRILL]);
    mockAgents([CONNECTED_AGENT_WITH_TWO_QUEUES]);
    server.use(
      http.get("*/api/v1/pos/printers/health", () =>
        HttpResponse.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503 }),
      ),
    );
    renderForm();

    const notice = await screen.findByTestId("printer-health-unavailable");
    expect(notice.textContent).toMatch(/not a statement that they are working/i);
  });
});
