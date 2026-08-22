import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { PosRepository } from "@/lib/repositories/pos.repository";

/**
 * S1-03: the till rendered the first 20 menu items and could not tell that more existed.
 *
 * `getMenuItems` issued one request with `{categoryId, branchId}` and no `size`, against
 * `GET /pos/menu/items` — which takes a Spring `Pageable` whose default page size is 20. A
 * 30-item menu arrived as 20 tiles, and because the grid's search filters client-side over what
 * was already fetched, the ten that never arrived could not be found by searching either.
 *
 * The handler below is deliberately a FAITHFUL Spring pager, not a convenience: it defaults to
 * size 20 when the caller omits `size`, exactly as the real endpoint does. That is what makes
 * this test fail against the old single-request implementation instead of quietly passing.
 */

const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const CATEGORY_ID = "c0000001-0000-4000-8000-000000000002";

const MENU: { id: string; name: string; basePricePaisa: number }[] = Array.from(
  { length: 30 },
  (_, i) => ({
    id: `a1000001-0000-4000-8000-0000000${String(i + 1).padStart(5, "0")}`,
    name: `ZZ-${String(i + 1).padStart(2, "0")}`,
    basePricePaisa: 10_000 + (i + 1) * 100,
  }),
);

/** Every request the repository made, in order — the seam under test. */
let requestedPages: { page: string | null; size: string | null; categoryId: string | null }[] = [];

/** Spring's default page size. Omitting `size` is what silently truncated the till. */
const SPRING_DEFAULT_PAGE_SIZE = 20;

function pagedMenuHandler() {
  return http.get("*/api/v1/pos/menu/items", ({ request }) => {
    const url = new URL(request.url);
    requestedPages.push({
      page: url.searchParams.get("page"),
      size: url.searchParams.get("size"),
      categoryId: url.searchParams.get("categoryId"),
    });

    const size = Number(url.searchParams.get("size") ?? SPRING_DEFAULT_PAGE_SIZE);
    const page = Number(url.searchParams.get("page") ?? 0);
    const start = page * size;
    const slice = MENU.slice(start, start + size);
    const hasNext = start + size < MENU.length;

    return HttpResponse.json({
      data: slice.map((m) => ({
        id: m.id,
        categoryId: CATEGORY_ID,
        name: m.name,
        description: null,
        basePricePaisa: m.basePricePaisa,
        taxRatePct: "0.00",
        kdsStation: null,
        active: true,
      })),
      meta: {
        page: { cursor: String(page), nextCursor: hasNext ? String(page + 1) : null, limit: size },
        totalCount: MENU.length,
      },
      warnings: [],
    });
  });
}

describe("PosRepository.getMenuItems — the till gets the WHOLE menu", () => {
  beforeEach(() => {
    requestedPages = [];
    server.use(pagedMenuHandler());
  });

  it("returns every active item, not the first page", async () => {
    const items = await PosRepository.getMenuItems({ branchId: BRANCH_ID });

    expect(items).toHaveLength(30);
    // ZZ-29 is the item the acceptance criterion searches for at the till: 29th by name, so it
    // falls outside a default 20-row page and was previously unreachable and unsearchable.
    expect(items.map((i) => i.name)).toContain("ZZ-29");
    expect(items.map((i) => i.name)).toContain("ZZ-30");
  });

  it("carries the price of an item past the first page intact, in paisa", async () => {
    const items = await PosRepository.getMenuItems({ branchId: BRANCH_ID });
    const zz29 = items.find((i) => i.name === "ZZ-29");

    expect(zz29?.basePricePaisa).toBe(12_900);
  });

  it("asks for an explicit size rather than inheriting Spring's default of 20", async () => {
    await PosRepository.getMenuItems({ branchId: BRANCH_ID });

    expect(requestedPages[0]?.size).not.toBeNull();
    expect(Number(requestedPages[0]?.size)).toBeGreaterThan(SPRING_DEFAULT_PAGE_SIZE);
  });

  it("does the same for a single category", async () => {
    const items = await PosRepository.getMenuItems({
      branchId: BRANCH_ID,
      categoryId: CATEGORY_ID,
    });

    expect(items).toHaveLength(30);
    expect(requestedPages[0]?.categoryId).toBe(CATEGORY_ID);
  });

  it("follows nextCursor to the end when the server's page is smaller than the menu", async () => {
    // A server that caps its page size below what we asked for must still be walked to the end.
    server.use(
      http.get("*/api/v1/pos/menu/items", ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get("page") ?? 0);
        const size = 12; // server-imposed cap, smaller than the client's request
        const slice = MENU.slice(page * size, page * size + size);
        requestedPages.push({ page: String(page), size: String(size), categoryId: null });
        return HttpResponse.json({
          data: slice.map((m) => ({
            id: m.id,
            categoryId: CATEGORY_ID,
            name: m.name,
            description: null,
            basePricePaisa: m.basePricePaisa,
            taxRatePct: "0.00",
            kdsStation: null,
            active: true,
          })),
          meta: {
            page: {
              cursor: String(page),
              nextCursor: (page + 1) * size < MENU.length ? String(page + 1) : null,
              limit: size,
            },
            totalCount: MENU.length,
          },
          warnings: [],
        });
      }),
    );

    const items = await PosRepository.getMenuItems({ branchId: BRANCH_ID });

    expect(items).toHaveLength(30);
    expect(new Set(items.map((i) => i.id)).size).toBe(30); // no page repeated
    expect(requestedPages.map((r) => r.page)).toEqual(["0", "1", "2"]);
  });

  it("stops instead of looping when a server repeats a page forever", async () => {
    // A backend that always claims a next page must not hang the till. The loop is bounded.
    server.use(
      http.get("*/api/v1/pos/menu/items", () => {
        requestedPages.push({ page: null, size: null, categoryId: null });
        return HttpResponse.json({
          data: [
            {
              id: MENU[0]!.id,
              categoryId: CATEGORY_ID,
              name: MENU[0]!.name,
              description: null,
              basePricePaisa: MENU[0]!.basePricePaisa,
              taxRatePct: "0.00",
              kdsStation: null,
              active: true,
            },
          ],
          meta: { page: { cursor: "0", nextCursor: "1", limit: 1 }, totalCount: 999_999 },
          warnings: [],
        });
      }),
    );

    const items = await PosRepository.getMenuItems({ branchId: BRANCH_ID });

    expect(requestedPages.length).toBeLessThanOrEqual(10);
    expect(items.length).toBeGreaterThan(0);
  });
});
