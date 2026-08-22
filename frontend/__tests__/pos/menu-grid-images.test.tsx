import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { MenuGrid } from "@/components/pos/menu-grid";
import { __resetAuthenticatedImageCache } from "@/lib/hooks/files/use-file-upload";

/**
 * S7 — "menu item images never reach the POS grid".
 *
 * <p>Walkthrough §3 #24: forty tiles on the till, every one of them text-and-price, including the
 * item literally named `Photo Dish 50585`. The picture was NOT missing — the manager's own Menu
 * Items screen painted it at its true 120×120 one route away, and `MenuItem.imageUrl` was on the
 * model the grid was already reading. `components/pos/menu-grid.tsx` simply contained no `img`,
 * no `Image` and no `imageUrl`: 293 lines of grid that threw the photograph away.
 *
 * <p>These tests assert what the CASHIER sees, not what the component is passed. Before the fix
 * the first one fails on `findByAltText` — there is no `<img>` in the document to find — which is
 * the only failure that would have caught the original defect. A test asserting that MenuGrid
 * received an item carrying `imageUrl` passed happily the whole time it was broken.
 */

const CATEGORY_ID = "c1000001-0000-4000-8000-000000000001";
const PHOTO_FILE_ID = "f824d5c4-75b2-44b1-9e61-242733a6ea38";
const PHOTO_URL = `/api/v1/pos/menu/images/${PHOTO_FILE_ID}`;

const rawCategories = [
  { id: CATEGORY_ID, name: "Mains", description: null, sortOrder: 1, active: true },
];

const withPicture = {
  id: "a1000001-0000-4000-8000-000000000001",
  categoryId: CATEGORY_ID,
  name: "Chicken Karahi",
  description: null,
  basePricePaisa: 145000,
  taxRatePct: "5",
  kdsStation: "GRILL",
  active: true,
  imageFileId: PHOTO_FILE_ID,
  imageUrl: PHOTO_URL,
};

const withoutPicture = {
  id: "a1000001-0000-4000-8000-000000000002",
  categoryId: CATEGORY_ID,
  name: "Butter Naan",
  description: null,
  basePricePaisa: 8000,
  taxRatePct: "5",
  kdsStation: "TANDOOR",
  active: true,
  imageFileId: null,
  imageUrl: null,
};

/** A 1×1 PNG. Real bytes, so the blob has a real `size` for the cache budget to account for. */
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

function mockMenu(items: unknown[], imageStatus = 200) {
  server.use(
    // MenuGrid renders MenuScopeSwitch (menu-grid.tsx:191), which asks for the ADMIN catalogue.
    // MSW does not treat "*/menu/categories" as covering "/menu/categories/admin", so without
    // this the request is unhandled and onUnhandledRequest:"error" fails the test — but only on a
    // machine slow enough for the scope switch to fetch before the test ends, which is why CI saw
    // it and no local run did. The sibling menu suites all stub it (menu-items-page,
    // menu-item-tax-roundtrip, menu-availability-toggle).
    http.get("*/api/v1/pos/menu/categories/admin", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items", () =>
      HttpResponse.json({ data: items, meta: null, warnings: [] }),
    ),
    http.get(`*${PHOTO_URL}`, () => {
      if (imageStatus !== 200) return new HttpResponse(null, { status: imageStatus });
      return HttpResponse.arrayBuffer(PNG_BYTES.buffer as ArrayBuffer, {
        headers: { "Content-Type": "image/png" },
      });
    }),
  );
}

function renderGrid() {
  seedSession({ branchId: "branch-1" });
  const Wrapper = createQueryWrapper();
  const onItemSelect = vi.fn();
  render(
    <Wrapper>
      <MenuGrid onItemSelect={onItemSelect} cart={[]} onRemove={vi.fn()} onClearCart={vi.fn()} />
    </Wrapper>,
  );
  return { onItemSelect };
}

describe("MenuGrid — menu item pictures on the till", () => {
  beforeEach(() => {
    // jsdom implements neither. The object URL is plumbing, not the behaviour under test: what
    // matters is that an <img> carrying the dish's name reaches the DOM.
    let n = 0;
    globalThis.URL.createObjectURL = vi.fn(() => `blob:menu-image-${++n}`);
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    __resetAuthenticatedImageCache();
    clearSession();
  });

  it("shows the photograph on the tile of an item that has one", async () => {
    mockMenu([withPicture, withoutPicture]);
    renderGrid();

    const photo = await screen.findByAltText("Chicken Karahi", {}, { timeout: 4000 });
    expect(photo.tagName).toBe("IMG");
    expect(photo).toHaveAttribute("src", expect.stringMatching(/^blob:/));

    // ...and it is INSIDE that dish's tile, not floating somewhere else on the screen.
    const tile = photo.closest("button");
    expect(tile).not.toBeNull();
    expect(tile).toHaveTextContent("Chicken Karahi");
    expect(tile).toHaveTextContent("1,450.00");
  });

  it("still adds the line when the photographed tile is tapped", async () => {
    mockMenu([withPicture, withoutPicture]);
    const { onItemSelect } = renderGrid();
    const user = userEvent.setup();

    const photo = await screen.findByAltText("Chicken Karahi", {}, { timeout: 4000 });
    await user.click(photo.closest("button")!);

    expect(onItemSelect).toHaveBeenCalledTimes(1);
    expect(onItemSelect.mock.calls[0]?.[0]).toMatchObject({ name: "Chicken Karahi" });
  });

  it("gives the pictureless item a calm placeholder, never a broken image", async () => {
    mockMenu([withPicture, withoutPicture]);
    renderGrid();

    await screen.findByAltText("Chicken Karahi", {}, { timeout: 4000 });
    const naan = screen.getByText("Butter Naan").closest("button")!;

    // A placeholder, not a failed picture — the two must never be the same thing on screen.
    expect(naan.querySelector('[data-testid="menu-item-image-placeholder"]')).not.toBeNull();
    expect(naan.querySelector('[data-testid="menu-item-image-error"]')).toBeNull();
    expect(naan.querySelector("img")).toBeNull();
  });

  it("says a picture failed rather than pretending the dish has none", async () => {
    mockMenu([withPicture, withoutPicture], 500);
    renderGrid();

    const failed = await screen.findByLabelText(
      "Chicken Karahi — picture could not be loaded",
      {},
      { timeout: 4000 },
    );
    expect(failed).toBeInTheDocument();
    // The tile is still a tile: the dish stays sellable when its photograph does not arrive.
    expect(failed.closest("button")).toHaveTextContent("Chicken Karahi");
  });

  it("spends no space on a photo strip when nothing in view is photographed", async () => {
    mockMenu([withoutPicture]);
    renderGrid();

    await screen.findByText("Butter Naan");
    await waitFor(() =>
      expect(screen.queryByTestId("menu-item-image-placeholder")).not.toBeInTheDocument(),
    );
  });

  it("fetches one picture once however many tiles show it", async () => {
    const sameShot = { ...withoutPicture, name: "Karahi Half", imageUrl: PHOTO_URL };
    let hits = 0;
    server.use(
      // MenuGrid renders MenuScopeSwitch (menu-grid.tsx:191), which asks for the ADMIN catalogue.
    // MSW does not treat "*/menu/categories" as covering "/menu/categories/admin", so without
    // this the request is unhandled and onUnhandledRequest:"error" fails the test — but only on a
    // machine slow enough for the scope switch to fetch before the test ends, which is why CI saw
    // it and no local run did. The sibling menu suites all stub it (menu-items-page,
    // menu-item-tax-roundtrip, menu-availability-toggle).
    http.get("*/api/v1/pos/menu/categories/admin", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/categories", () =>
        HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
      ),
      http.get("*/api/v1/pos/menu/items", () =>
        HttpResponse.json({ data: [withPicture, sameShot], meta: null, warnings: [] }),
      ),
      http.get(`*${PHOTO_URL}`, () => {
        hits += 1;
        return HttpResponse.arrayBuffer(PNG_BYTES.buffer as ArrayBuffer, {
          headers: { "Content-Type": "image/png" },
        });
      }),
    );
    renderGrid();

    await screen.findByAltText("Chicken Karahi", {}, { timeout: 4000 });
    await screen.findByAltText("Karahi Half", {}, { timeout: 4000 });
    // Two tiles, one photograph, one request. A per-component fetch would make this 2 — and 40 on
    // a fully photographed menu, again on every category tap, mid-service.
    expect(hits).toBe(1);
  });
});
