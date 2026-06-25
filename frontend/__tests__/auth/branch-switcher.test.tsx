import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useSessionStore } from "@/lib/auth/session";
import { useSwitchBranch } from "@/lib/hooks/auth/use-switch-branch";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { BranchSwitcher } from "@/components/shared/branch-switcher";

const MAIN_BRANCH = "33333333-3333-4333-8333-333333333333";
const ALT_BRANCH = "44444444-4444-4444-8444-444444444444";

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
    // A pre-existing branch-scoped key that must be invalidated by the switch.
    queryClient.setQueryData(queryKeys.features.all(MAIN_BRANCH), ["FEATURE_POS"]);

    const { result } = renderHook(() => useSwitchBranch(), { wrapper });
    result.current.mutate(ALT_BRANCH);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Cache cleared (every key is branch-scoped) and session moved to the new branch.
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
    // Session branch unchanged and the cache was NOT cleared.
    expect(useSessionStore.getState().session?.branchId).toBe(MAIN_BRANCH);
    expect(queryClient.getQueryData(queryKeys.features.all(MAIN_BRANCH))).toEqual([
      "FEATURE_POS",
    ]);
  });
});

describe("BranchSwitcher", () => {
  beforeEach(() => seedSession({ branchId: MAIN_BRANCH }));
  afterEach(() => clearSession());

  it("renders the active branch name", () => {
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <BranchSwitcher />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/switch branch/i)).toHaveTextContent("Main Branch");
  });
});
