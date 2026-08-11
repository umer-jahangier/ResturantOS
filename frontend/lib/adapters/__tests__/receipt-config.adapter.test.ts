import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiReceiptConfigResponseSchema,
  apiReceiptConfigSchema,
} from "@/lib/api-client/schemas/receipt-config.schema";
import { adaptReceiptConfigResponse } from "@/lib/adapters/receipt-config.adapter";
import { EMPTY_RECEIPT_CONFIG } from "@/lib/models/receipt-config.model";

vi.mock("@/lib/repositories/receipt-config.repository", () => ({
  ReceiptConfigRepository: {
    get: vi.fn(),
    save: vi.fn(),
  },
}));

// Imported AFTER the mock declaration so the hooks close over the mocked module.
const { ReceiptConfigRepository } = await import("@/lib/repositories/receipt-config.repository");
const { useReceiptConfig, useSaveReceiptConfig, receiptConfigKeys } =
  await import("@/lib/hooks/settings/use-receipt-config");

const BRANCH = "22222222-2222-4222-8222-222222222222";
const TERMINAL = "11110000-0000-4000-8000-000000000a01";

/** The realistic half-configured branch: a counter printer, a hot station, and an unrouted COLD. */
function fullResponse() {
  return {
    config: {
      agent: { baseUrl: "http://127.0.0.1:7654", lanUrl: "http://till-01.local:7654" },
      printers: [
        {
          id: "receipt-1",
          terminalId: null,
          role: "RECEIPT",
          stationCode: null,
          transport: "TCP",
          host: "10.0.7.21",
          port: 9100,
          systemPrinterName: null,
          widthMm: 80,
          columns: 48,
          columnsMeasured: false,
          codepage: "CP864",
          cut: "PARTIAL",
          drawerPin: 2,
          drawerPulseMs: 100,
        },
        {
          id: "kitchen-hot",
          terminalId: TERMINAL,
          role: "KITCHEN",
          stationCode: "HOT",
          transport: "SYSTEM",
          host: null,
          port: null,
          systemPrinterName: "EPSON TM-T88",
          widthMm: 80,
          columns: 42,
          columnsMeasured: true,
          codepage: "CP437",
          cut: "FULL",
          drawerPin: null,
          drawerPulseMs: null,
        },
      ],
      header: { logoFileId: null, lines: ["Floating Terrace"] },
      footer: { lines: ["Thank you"] },
      fbr: { printLogo: true, qrSizeMm: 25.4 },
      kitchenStations: ["HOT", "COLD"],
    },
    completeness: {
      complete: false,
      unroutedStations: ["COLD"],
      warnings: ["Printer 'receipt-1' has an UNMEASURED column count (48)"],
    },
  };
}

/** What user-service returns for a branch nobody has configured. */
function emptyResponse() {
  return {
    config: {
      agent: null,
      printers: [],
      header: null,
      footer: null,
      fbr: null,
      kitchenStations: [],
    },
    completeness: { complete: false, unroutedStations: [], warnings: [] },
  };
}

function wrapperWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

describe("receipt config wire contract", () => {
  beforeEach(() => {
    vi.mocked(ReceiptConfigRepository.get).mockReset();
    vi.mocked(ReceiptConfigRepository.save).mockReset();
  });

  it("parses a fully populated configuration and rejects an unknown transport", () => {
    const parsed = apiReceiptConfigResponseSchema.parse(fullResponse());
    expect(parsed.config?.printers).toHaveLength(2);
    expect(parsed.config?.printers[0]?.transport).toBe("TCP");
    expect(parsed.config?.printers[1]?.transport).toBe("SYSTEM");

    const bogus = fullResponse();
    bogus.config.printers[0]!.transport = "bluetooth";
    const result = apiReceiptConfigSchema.safeParse(bogus.config);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("transport");

    // And the same for the other two closed sets, which a form could equally get wrong.
    const badRole = fullResponse();
    badRole.config.printers[0]!.role = "LABEL";
    expect(apiReceiptConfigSchema.safeParse(badRole.config).success).toBe(false);

    const badCut = fullResponse();
    badCut.config.printers[0]!.cut = "GUILLOTINE";
    expect(apiReceiptConfigSchema.safeParse(badCut.config).success).toBe(false);
  });

  it("parses a never-configured branch to an explicitly empty configuration", () => {
    const view = adaptReceiptConfigResponse(apiReceiptConfigResponseSchema.parse(emptyResponse()));

    expect(view.config).toEqual(EMPTY_RECEIPT_CONFIG);
    expect(view.config.printers).toEqual([]);
    expect(view.config.agent).toBeNull();
    expect(view.completeness.complete).toBe(false);

    // A null config from the wire tolerates the same way — an absence, never an undefined.
    const nullConfig = adaptReceiptConfigResponse(
      apiReceiptConfigResponseSchema.parse({
        config: null,
        completeness: emptyResponse().completeness,
      }),
    );
    expect(nullConfig.config.printers).toEqual([]);
  });

  it("carries the unrouted station list and the unmeasured-columns flag into the domain model", () => {
    const view = adaptReceiptConfigResponse(apiReceiptConfigResponseSchema.parse(fullResponse()));

    // The load-bearing field: a declared station nothing routes.
    expect(view.completeness.unroutedStations).toEqual(["COLD"]);
    expect(view.completeness.complete).toBe(false);
    expect(view.completeness.warnings[0]).toContain("UNMEASURED");

    expect(view.config.printers[0]?.columnsMeasured).toBe(false);
    expect(view.config.printers[1]?.columnsMeasured).toBe(true);
    expect(view.config.printers[0]?.terminalId).toBeNull();
    expect(view.config.printers[1]?.terminalId).toBe(TERMINAL);
    expect(view.config.printers[0]?.drawerPin).toBe(2);
    expect(view.config.printers[1]?.drawerPin).toBeNull();
    expect(view.config.kitchenStations).toEqual(["HOT", "COLD"]);
  });
});

describe("useReceiptConfig", () => {
  beforeEach(() => {
    vi.mocked(ReceiptConfigRepository.get).mockReset();
    vi.mocked(ReceiptConfigRepository.save).mockReset();
  });

  it("returns the configuration on success", async () => {
    const view = adaptReceiptConfigResponse(apiReceiptConfigResponseSchema.parse(fullResponse()));
    vi.mocked(ReceiptConfigRepository.get).mockResolvedValue(view);

    const { wrapper } = wrapperWithClient();
    const { result } = renderHook(() => useReceiptConfig(BRANCH), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.config.printers).toHaveLength(2);
    expect(result.current.isError).toBe(false);
  });

  /**
   * The one that matters. A failed read must NOT look like "no printers configured" — a manager
   * who believes that enters a second configuration over a first one that was fine.
   */
  it("a rejected fetch leaves isError true and produces NO configuration at all", async () => {
    vi.mocked(ReceiptConfigRepository.get).mockRejectedValue(new Error("gateway 503"));

    const { wrapper } = wrapperWithClient();
    const { result } = renderHook(() => useReceiptConfig(BRANCH), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    // Not an empty configuration wearing a success face.
    expect(result.current.isSuccess).toBe(false);
    expect(JSON.stringify(result.current.data ?? null)).not.toContain("printers");
  });

  it("does not fetch until a branch is known", () => {
    const { wrapper } = wrapperWithClient();
    renderHook(() => useReceiptConfig(null), { wrapper });
    expect(ReceiptConfigRepository.get).not.toHaveBeenCalled();
  });
});

describe("useSaveReceiptConfig", () => {
  beforeEach(() => {
    vi.mocked(ReceiptConfigRepository.get).mockReset();
    vi.mocked(ReceiptConfigRepository.save).mockReset();
  });

  it("invalidates the read query key on success", async () => {
    const view = adaptReceiptConfigResponse(apiReceiptConfigResponseSchema.parse(fullResponse()));
    vi.mocked(ReceiptConfigRepository.save).mockResolvedValue(view);

    const { queryClient, wrapper } = wrapperWithClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSaveReceiptConfig(BRANCH), { wrapper });
    result.current.mutate(view.config);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: receiptConfigKeys.branch(BRANCH) });
  });

  it("does not invalidate when the save fails", async () => {
    vi.mocked(ReceiptConfigRepository.save).mockRejectedValue(new Error("400 host is required"));

    const { queryClient, wrapper } = wrapperWithClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSaveReceiptConfig(BRANCH), { wrapper });
    result.current.mutate(EMPTY_RECEIPT_CONFIG);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
