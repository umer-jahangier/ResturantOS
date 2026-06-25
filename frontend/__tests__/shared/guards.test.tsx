import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { FeatureGuard } from "@/components/shared/feature-guard";

describe("PermissionGuard", () => {
  afterEach(() => clearSession());

  it("renders children when the required permission is in the decoded JWT claims", () => {
    seedSession({ permissions: ["order:create", "order:read"] });
    render(
      <PermissionGuard require="order:create">
        <span>visible</span>
      </PermissionGuard>,
    );
    expect(screen.getByText("visible")).toBeInTheDocument();
  });

  it("hides children when the required permission is absent", () => {
    seedSession({ permissions: ["order:read"] });
    render(
      <PermissionGuard require="finance:close">
        <span>secret</span>
      </PermissionGuard>,
    );
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("supports mode='any'", () => {
    seedSession({ permissions: ["order:read"] });
    render(
      <PermissionGuard require={["finance:close", "order:read"]} mode="any">
        <span>any-ok</span>
      </PermissionGuard>,
    );
    expect(screen.getByText("any-ok")).toBeInTheDocument();
  });
});

describe("FeatureGuard", () => {
  afterEach(() => clearSession());

  it("shows enabled features and hides disabled ones from the MSW flags response", async () => {
    seedSession({ branchId: "branch-flags" });
    const Wrapper = createQueryWrapper();

    render(
      <Wrapper>
        <FeatureGuard feature="FEATURE_POS">
          <span>pos-on</span>
        </FeatureGuard>
        <FeatureGuard feature="FEATURE_NOPE">
          <span>nope-on</span>
        </FeatureGuard>
      </Wrapper>,
    );

    // When the enabled flag appears, the shared flags query has resolved — so a
    // missing flag is correctly hidden (not merely still loading).
    expect(await screen.findByText("pos-on")).toBeInTheDocument();
    expect(screen.queryByText("nope-on")).not.toBeInTheDocument();
  });
});
