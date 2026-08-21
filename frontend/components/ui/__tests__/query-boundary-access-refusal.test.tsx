import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QueryBoundary } from "@/components/ui/query-boundary";
import { ApiError } from "@/lib/errors";

/**
 * A 403 must never render as an empty state, and the two kinds of 403 must never render as each
 * other.
 *
 * GA-001 established the first half: eleven list screens showed "No vendors yet" when the request
 * had failed, telling an owner their business has no vendors. 36-02 adds the second half. A tenant
 * whose plan does not include purchasing and a user whose role may not see purchasing are different
 * situations with different remedies — upgrade the plan, or change the role assignment — and until
 * now the product showed both the same red "Couldn't load vendors" box with a retry button that
 * could never work.
 */

function failedWith(error: unknown) {
  return { isError: true, error, isPending: false, isLoading: false };
}

const forbiddenFeature = new ApiError({
  code: "FEATURE_DISABLED",
  message: "This feature is not available on your current plan",
  status: 403,
  traceId: "t-1",
  fieldErrors: [],
});

const forbiddenPermission = new ApiError({
  code: "PERMISSION_DENIED",
  message: "You do not have permission to perform this action",
  status: 403,
  traceId: "t-2",
  fieldErrors: [],
});

describe("QueryBoundary — the two 403 shapes", () => {
  it("a disabled module says the plan does not include it, and names the module", () => {
    render(
      <QueryBoundary
        query={failedWith(forbiddenFeature)}
        what="vendors"
        moduleLabel="Purchasing"
        isEmpty
        empty={<p>No vendors yet</p>}
      >
        <p>the list</p>
      </QueryBoundary>,
    );

    const notice = screen.getByTestId("query-access-refusal");
    expect(notice).toHaveAttribute("data-refusal-kind", "feature-disabled");
    expect(notice.textContent).toContain("Purchasing is not enabled for this account");
    expect(notice.textContent).toContain("plan does not include purchasing");
    // Not the empty state, not the generic failure, and no retry button.
    expect(screen.queryByText("No vendors yet")).toBeNull();
    expect(screen.queryByTestId("query-error")).toBeNull();
    expect(screen.queryByTestId("query-error-retry")).toBeNull();
  });

  it("a permission refusal talks about the role, and names no permission code", () => {
    render(
      <QueryBoundary
        query={failedWith(forbiddenPermission)}
        what="vendors"
        moduleLabel="Purchasing"
        isEmpty
        empty={<p>No vendors yet</p>}
      >
        <p>the list</p>
      </QueryBoundary>,
    );

    const notice = screen.getByTestId("query-access-refusal");
    expect(notice).toHaveAttribute("data-refusal-kind", "permission-denied");
    expect(notice.textContent).toContain("signed-in role may not perform this action");
    // Discloses no authority string and no plan tier — a probing user learns nothing.
    expect(notice.textContent).not.toContain("vendor.");
    expect(notice.textContent).not.toContain("plan");
    expect(screen.queryByText("No vendors yet")).toBeNull();
  });

  it("the two refusals do not render as each other", () => {
    const { unmount } = render(
      <QueryBoundary query={failedWith(forbiddenFeature)} what="vendors" moduleLabel="Purchasing">
        <p>the list</p>
      </QueryBoundary>,
    );
    const featureText = screen.getByTestId("query-access-refusal").textContent;
    unmount();

    render(
      <QueryBoundary
        query={failedWith(forbiddenPermission)}
        what="vendors"
        moduleLabel="Purchasing"
      >
        <p>the list</p>
      </QueryBoundary>,
    );
    const permissionText = screen.getByTestId("query-access-refusal").textContent;

    expect(featureText).not.toEqual(permissionText);
  });

  it("a non-403 failure is still the ordinary error state, with a retry", () => {
    const boom = new ApiError({
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
      status: 500,
      traceId: "t-3",
      fieldErrors: [],
    });

    render(
      <QueryBoundary query={{ ...failedWith(boom), refetch: () => undefined }} what="vendors">
        <p>the list</p>
      </QueryBoundary>,
    );

    expect(screen.getByTestId("query-error")).toBeTruthy();
    expect(screen.getByTestId("query-error-retry")).toBeTruthy();
    expect(screen.queryByTestId("query-access-refusal")).toBeNull();
  });
});
