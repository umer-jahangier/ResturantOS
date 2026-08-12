import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { MenuScopeSwitch, ownMenuCategoryScope } from "@/components/pos/menu-scope-switch";
import type { MenuCategory } from "@/lib/models/pos.model";

/**
 * The admin's own switch, and the one thing about it that must never drift: it is a VIEW filter.
 *
 * <p>The failure this guards against is not a broken filter — it is a reader, six months from now,
 * concluding that this is where the boundary lives and then "simplifying" the OPA call away. So the
 * tests assert the copy that says otherwise, not only the behaviour.
 */

const DRINKS = "1c5f7cbe-4f3a-4f2e-9a3f-2a5f6b8c1d2e";
const MAINS = "2d6a8dcf-5a4b-4b3f-8b4a-3b6a7c9d2e3f";

const CATEGORIES: MenuCategory[] = [
  {
    id: DRINKS,
    name: "Main Bar",
    description: null,
    sortOrder: 1,
    active: true,
    taxClassId: null,
    taxClassName: null,
    taxClassRatePct: null,
  },
  {
    id: MAINS,
    name: "Mains",
    description: null,
    sortOrder: 2,
    active: true,
    taxClassId: null,
    taxClassName: null,
    taxClassRatePct: null,
  },
];

function renderSwitch(props: Partial<React.ComponentProps<typeof MenuScopeSwitch>> = {}) {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <MenuScopeSwitch
        categories={CATEGORIES}
        preview={null}
        onPreviewChange={() => {}}
        {...props}
      />
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  clearSession();
});

describe("reading the operator's own scope off their token", () => {
  it("treats every malformed claim as unrestricted, exactly as MenuCategoryScope does", () => {
    // Reading any of these as "permitted: nothing" would blank a till mid-service. The real
    // boundary fails CLOSED, separately, in OPA.
    expect(ownMenuCategoryScope({})).toBeNull();
    expect(ownMenuCategoryScope({ menu_categories: null })).toBeNull();
    expect(ownMenuCategoryScope({ menu_categories: [] })).toBeNull();
    expect(ownMenuCategoryScope({ menu_categories: "DRINKS" })).toBeNull();
    expect(ownMenuCategoryScope({ menu_categories: [1, 2] })).toBeNull();
  });

  it("reads a real claim, under the literal key auth-service mints", () => {
    // The literal, not a constant asserted against itself. A rename on either side hands every
    // confined cashier the whole menu back without throwing.
    expect(ownMenuCategoryScope({ menu_categories: [DRINKS] })).toEqual([DRINKS]);
  });
});

describe("an UNRESTRICTED operator gets the switch", () => {
  it("stays COLLAPSED until asked, so it cannot shadow the category rail below it", async () => {
    seedSession({ roles: ["OWNER"], attributes: {} });
    renderSwitch();

    // Wait FOR the toggle — the positive control. Only then is the panel's absence a decision.
    const toggle = await screen.findByTestId("menu-scope-switch-toggle");
    expect(toggle).toHaveTextContent(/whole menu/i);
    expect(screen.queryByTestId("menu-scope-switch-panel")).not.toBeInTheDocument();
    // The category names must NOT be on screen twice: the rail beneath this renders the same
    // labels, and two identical pill rows doing different things is the ambiguity that made
    // `getByText("Mains")` match two elements in menu-grid.test.tsx.
    expect(screen.queryByText("Mains")).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(await screen.findByTestId("menu-scope-switch-panel")).toBeInTheDocument();
  });

  it("offers every section once opened", async () => {
    seedSession({ roles: ["OWNER"], attributes: {} });
    const onPreviewChange = vi.fn();
    renderSwitch({ onPreviewChange });

    await userEvent.click(await screen.findByTestId("menu-scope-switch-toggle"));
    await userEvent.click(screen.getByRole("checkbox", { name: /Main Bar/ }));
    expect(onPreviewChange).toHaveBeenCalledWith([DRINKS]);
  });

  it("names what it is showing, and offers one click back to everything", async () => {
    seedSession({ roles: ["OWNER"], attributes: {} });
    const onPreviewChange = vi.fn();
    renderSwitch({ preview: [DRINKS], onPreviewChange });

    expect(await screen.findByTestId("menu-scope-switch-toggle")).toHaveTextContent(
      "Working: Main Bar",
    );
    await userEvent.click(screen.getByTestId("menu-scope-switch-all"));
    expect(onPreviewChange).toHaveBeenCalledWith(null);
  });

  it("says the preview changes nothing on the server — the claim that must not drift", async () => {
    seedSession({ roles: ["OWNER"], attributes: {} });
    renderSwitch({ preview: [DRINKS] });

    await userEvent.click(await screen.findByTestId("menu-scope-switch-toggle"));
    const notice = await screen.findByTestId("menu-scope-switch-notice");
    expect(notice).toHaveTextContent(/changes nothing on the server/i);
    expect(notice).toHaveTextContent(/still ring the whole menu/i);
    // And it points at the control that DOES confine someone, so an owner who wanted the real
    // thing is not left believing they have it.
    expect(notice).toHaveTextContent(/Users screen/i);
  });

  it("un-ticking the last section stops previewing rather than showing an empty menu", async () => {
    seedSession({ roles: ["OWNER"], attributes: {} });
    const onPreviewChange = vi.fn();
    renderSwitch({ preview: [DRINKS], onPreviewChange });

    await userEvent.click(await screen.findByTestId("menu-scope-switch-toggle"));
    await userEvent.click(screen.getByRole("checkbox", { name: /Main Bar/ }));
    // NOT `[]`. There is no state in this product where an operator is shown an empty menu on
    // purpose, and an empty preview array would be exactly that.
    expect(onPreviewChange).toHaveBeenCalledWith(null);
  });
});

describe("a CONFINED operator gets no switch at all", () => {
  it("shows their scope as a sentence, and offers nothing to widen it with", async () => {
    seedSession({ roles: ["CASHIER"], attributes: { menu_categories: [DRINKS] } });
    renderSwitch({ categories: [CATEGORIES[0]!] });

    // Wait FOR the notice — the positive control that this component rendered at all. Only then is
    // the absence of the switcher a decision rather than an unrendered tree.
    const notice = await screen.findByTestId("menu-scope-confined-notice");
    expect(notice).toHaveTextContent("Main Bar");
    expect(screen.queryByTestId("menu-scope-switch")).not.toBeInTheDocument();
    expect(screen.queryByTestId("menu-scope-switch-toggle")).not.toBeInTheDocument();
  });
});
