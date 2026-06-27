import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse, delay } from "msw";

import { server } from "@/mocks/server";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useSessionStore } from "@/lib/auth/session";
import { useSwitchBranch } from "@/lib/hooks/auth/use-switch-branch";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { BranchSwitcher } from "@/components/shared/branch-switcher";

const MAIN_BRANCH = "b0000001-0000-4000-8000-000000000001";
const ALT_BRANCH = "b0000002-0000-4000-8000-000000000002";

const MINE_TWO_BRANCHES = [
  { id: MAIN_BRANCH, name: "Main Branch (HQ)", isHq: true, roleCode: "OWNER" },
  { id: ALT_BRANCH, name: "Downtown Branch", isHq: false, roleCode: "OWNER" },
];

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
  Toaster: () => null,
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useSwitchBranch", () => {
  beforeEach(() => {
    toastErrorMock.mockClear();
    seedSession({ branchId: MAIN_BRANCH });
  });
  afterEach(() => clearSession());

  it("reissues the JWT, updates the active branch, and clears the branch-scoped cache", async () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(queryKeys.features.all(MAIN_BRANCH), ["FEATURE_POS"]);

    const { result } = renderHook(() => useSwitchBranch(), { wrapper });
    result.current.mutate(ALT_BRANCH);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useSessionStore.getState().session?.branchId).toBe(ALT_BRANCH);
  });

  it("on 403 BRANCH_ACCESS_DENIED surfaces the error WITHOUT mutating the session or cache (W3)", async () => {
    server.use(
      http.post("*/api/v1/auth/switch-branch", () =>
        HttpResponse.json(
          { error: { code: "BRANCH_ACCESS_DENIED", message: "denied", details: [], traceId: "t" } },
          { status: 403 },
        ),
      ),
    );

    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(queryKeys.features.all(MAIN_BRANCH), ["FEATURE_POS"]);

    const { result } = renderHook(() => useSwitchBranch(), { wrapper });
    result.current.mutate(ALT_BRANCH);

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toastErrorMock).toHaveBeenCalled();
    expect(useSessionStore.getState().session?.branchId).toBe(MAIN_BRANCH);
    expect(queryClient.getQueryData(queryKeys.features.all(MAIN_BRANCH))).toEqual([
      "FEATURE_POS",
    ]);
  });
});

describe("BranchSwitcher", () => {
  beforeEach(() => seedSession({ branchId: MAIN_BRANCH }));
  afterEach(() => clearSession());

  it("shows a loading skeleton while branches are being fetched", async () => {
    server.use(
      http.get("*/api/v1/branches/mine", async () => {
        await delay(200);
        return HttpResponse.json({
          data: MINE_TWO_BRANCHES,
          meta: null,
          warnings: [],
        });
      }),
    );

    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <BranchSwitcher />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/loading branches/i)).toBeInTheDocument();
  });

  it("renders the active branch name when the user has multiple assignments", async () => {
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <BranchSwitcher />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/switch branch/i)).toHaveTextContent("Main Branch (HQ)");
    });
  });

  it("renders nothing when the user has only one assigned branch (US-1.3 AC1)", async () => {
    server.use(
      http.get("*/api/v1/branches/mine", () =>
        HttpResponse.json({
          data: [MINE_TWO_BRANCHES[0]],
          meta: null,
          warnings: [],
        }),
      ),
    );

    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <BranchSwitcher />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryByLabelText(/switch branch/i)).not.toBeInTheDocument();
    });
  });
});
