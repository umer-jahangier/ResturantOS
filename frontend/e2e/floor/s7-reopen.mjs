/*
 * S7 RE-OPEN — an INDEPENDENT attempt to break "menu item images reach the POS grid".
 *
 * Written from the DONE MEANS text, not from the other agent's harness. Different dish,
 * different fixture dimensions, fresh browser context per persona, and the adjacent paths
 * the original did not walk: the WAITER (who also works the grid), a second TENANT, a file
 * in the same tenant that is NOT a menu picture, and a reload.
 */
import { newBrowser, newPage, login, PEOPLE, BASE, go, apiGet, tokenOf } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S7-reopen");
mkdirSync(OUT, { recursive: true });
const results = [];
function claim(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}
async function snap(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

function makePng(path, w, h, rgb) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) raw.push(rgb[0], rgb[1], rgb[2]);
  }
  const crcT = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcT[n] = c >>> 0;
  }
  const chunk = (t, d) => {
    const b = Buffer.concat([Buffer.from(t, "ascii"), d]);
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    let crc = 0xffffffff;
    for (const x of b) crc = crcT[(crc ^ x) & 0xff] ^ (crc >>> 8);
    const c = Buffer.alloc(4);
    c.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([l, b, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.from(raw))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  return path;
}
const SCRATCH =
  "/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad";
mkdirSync(SCRATCH, { recursive: true });
// 320x200 — deliberately NOT the 240x180 the previous run used, so a cached blob cannot pass.
const FIXTURE = makePng(`${SCRATCH}/s7-reopen.png`, 320, 200, [17, 120, 200]);

/** Raw fetch with an explicit bearer, from inside the page. Returns status + headers. */
async function rawGet(page, path, token) {
  return page.evaluate(
    async ({ p, tok }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        credentials: "include",
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const ct = r.headers.get("content-type");
      const cc = r.headers.get("cache-control");
      let len = 0;
      try {
        const b = await r.blob();
        len = b.size;
      } catch {
        /* body already consumed / empty */
      }
      return { status: r.status, ct, cc, len };
    },
    { p: path, tok: token },
  );
}

/** Everything the till grid actually renders, read from geometry and computed style. */
async function probeGrid(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="menu-grid"]');
    if (!grid) return { grid: false };
    const cells = Array.from(grid.children);
    const read = (cell) => {
      const btn = cell.querySelector("button");
      const img = cell.querySelector('[data-testid="menu-item-image"]');
      const ph = cell.querySelector('[data-testid="menu-item-image-placeholder"]');
      const err = cell.querySelector('[data-testid="menu-item-image-error"]');
      const nameEl = btn?.querySelector("span > span");
      const bR = btn?.getBoundingClientRect();
      const iR = img?.getBoundingClientRect();
      const nR = nameEl?.getBoundingClientRect();
      const iS = img ? getComputedStyle(img) : null;
      const nS = nameEl ? getComputedStyle(nameEl) : null;
      return {
        name: (nameEl?.textContent || "").trim(),
        text: (btn?.innerText || "").replace(/\n/g, " · ").trim(),
        hasImg: !!img,
        placeholder: !!ph,
        error: !!err,
        nw: img?.naturalWidth ?? 0,
        nh: img?.naturalHeight ?? 0,
        complete: img?.complete ?? null,
        tile: bR ? { w: Math.round(bR.width), h: Math.round(bR.height) } : null,
        imgBox: iR ? { w: Math.round(iR.width), h: Math.round(iR.height) } : null,
        objectFit: iS?.objectFit ?? null,
        visibility: iS?.visibility ?? null,
        opacity: iS?.opacity ?? null,
        display: iS?.display ?? null,
        nameFont: nS?.fontSize ?? null,
        nameColor: nS?.color ?? null,
        overlaps:
          iR && nR
            ? nR.left < iR.right && nR.right > iR.left && nR.top < iR.bottom && nR.bottom > iR.top
            : false,
      };
    };
    const tiles = cells.map(read);
    return {
      grid: true,
      count: tiles.length,
      imgs: tiles.filter((t) => t.hasImg).length,
      errors: tiles.filter((t) => t.error).length,
      heights: Array.from(new Set(tiles.map((t) => t.tile?.h))),
      tiles,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

const T = (page, id) =>
  page.evaluate(
    (i) => (document.querySelector(`[data-testid="${i}"]`) ? true : false),
    id,
  );

async function run() {
  const browser = await newBrowser();
  let target = null; // { id, name, fileId, url }

  // ───────────────────────────── 1. MANAGER uploads a picture ────────────────
  const mgr = await newPage(browser);
  await login(mgr, PEOPLE.manager);
  let t = await go(mgr, "/app/menu/items", { waitMs: 4000 });
  claim("manager /app/menu/items loads cleanly", t.bad.length === 0, JSON.stringify(t.bad));

  const mgrTok = await tokenOf(mgr);
  const menu = await apiGet(mgr, "/api/v1/pos/menu/items?page=0&size=200", mgrTok);
  const items = menu.body?.data?.content ?? menu.body?.data ?? menu.body?.content ?? [];
  const noPic = items.filter((i) => !i.imageUrl && i.active !== false);
  claim(
    "menu read as manager",
    Array.isArray(items) && items.length > 0,
    `${items.length} items, ${noPic.length} without a picture`,
  );
  if (!noPic.length) throw new Error("no unphotographed dish to use");
  // Pick from the far end of the list so this is not the same row the last run used.
  const pick = noPic[noPic.length - 1];
  console.log(`  → target dish: ${pick.name} (${pick.id})`);

  // Drive the real UI: search, Actions → Edit, choose file, Save.
  const search = mgr.locator('input[placeholder*="earch"]').first();
  if (await search.count()) {
    await search.fill(pick.name);
    await mgr.waitForTimeout(2500);
  }
  const row = mgr.locator("tr", { hasText: pick.name }).first();
  await row.locator("button").last().click();
  await mgr.waitForTimeout(900);
  await mgr.getByRole("menuitem", { name: /edit/i }).first().click();
  await mgr.waitForTimeout(1800);
  await snap(mgr, "01-edit-dialog");
  const fileInput = mgr.locator('input[type="file"]').first();
  await fileInput.setInputFiles(FIXTURE);
  await mgr.waitForTimeout(3500);
  await snap(mgr, "02-picture-chosen");
  await mgr.getByRole("button", { name: /save/i }).first().click();
  await mgr.waitForTimeout(4000);
  await snap(mgr, "03-saved");

  // Full reload, then read the API again — persistence, not optimism.
  await go(mgr, "/app/menu/items", { waitMs: 4000 });
  const menu2 = await apiGet(mgr, "/api/v1/pos/menu/items?page=0&size=200", await tokenOf(mgr));
  const items2 = menu2.body?.data?.content ?? menu2.body?.data ?? [];
  const after = items2.find((i) => i.id === pick.id);
  const url = after?.imageUrl ?? null;
  claim(
    "the upload PERSISTED and the API derives the menu route",
    !!url && url.startsWith("/api/v1/pos/menu/images/"),
    `imageUrl=${url}`,
  );
  target = { id: pick.id, name: pick.name, url, fileId: url?.split("/").pop() };

  // manager's own list paints it
  if (await (await mgr.locator('input[placeholder*="earch"]').first()).count()) {
    await mgr.locator('input[placeholder*="earch"]').first().fill(pick.name);
    await mgr.waitForTimeout(3000);
  }
  const mgrImg = await mgr.evaluate((nm) => {
    const imgs = Array.from(document.querySelectorAll('[data-testid="menu-item-image"]'));
    const m = imgs.find((i) => i.alt === nm);
    return m ? { alt: m.alt, nw: m.naturalWidth, nh: m.naturalHeight } : null;
  }, pick.name);
  claim(
    "manager's admin list paints the picture after a full reload",
    !!mgrImg && mgrImg.nw === 320 && mgrImg.nh === 200,
    JSON.stringify(mgrImg),
  );
  await snap(mgr, "04-manager-list-after-reload");

  // ───────────────────────────── 2. CASHIER at the till ──────────────────────
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);
  const cashTok = await tokenOf(cash);
  const perms = await cash.evaluate((tok) => {
    try {
      const p = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return p.permissions ?? p.authorities ?? p.scope ?? null;
    } catch {
      return null;
    }
  }, cashTok);
  const permList = Array.isArray(perms) ? perms : String(perms || "").split(/[ ,]+/);
  claim(
    "the cashier holds pos.menu.view and NO file.* permission",
    permList.includes("pos.menu.view") && !permList.some((p) => p.startsWith("file.")),
    `${permList.length} perms; file.*=${permList.filter((p) => p.startsWith("file.")).join(",") || "none"}`,
  );

  const imgRes = await rawGet(cash, target.url, cashTok);
  claim(
    "the cashier's OWN bearer fetches the picture",
    imgRes.status === 200 && (imgRes.ct || "").startsWith("image/"),
    JSON.stringify(imgRes),
  );
  const dlRes = await rawGet(cash, `/api/v1/files/${target.fileId}/download`, cashTok);
  claim(
    "the cashier is STILL refused the tenant-wide file read (no widened permission)",
    dlRes.status === 403,
    `GET /api/v1/files/{id}/download → ${dlRes.status}`,
  );

  // A random file id — must be indistinguishable from "not a menu picture".
  const randomId = "00000000-0000-4000-8000-0000000000aa";
  const randRes = await rawGet(cash, `/api/v1/pos/menu/images/${randomId}`, cashTok);
  claim(
    "a file id that is not on this tenant's menu answers 404, not 403",
    randRes.status === 404,
    `random uuid → ${randRes.status}`,
  );

  t = await go(cash, "/app/pos", { waitMs: 6000 });
  claim("cashier /app/pos loads cleanly", t.bad.length === 0, JSON.stringify(t.bad) + " " + JSON.stringify(t.alerts || []));
  await cash.waitForTimeout(3000);
  let g = await probeGrid(cash);
  await snap(cash, "05-cashier-till");
  const tile = g.tiles?.find((x) => x.name === target.name);
  claim(
    "the till renders the photograph on that dish's tile",
    !!tile && tile.hasImg && tile.nw === 320 && tile.nh === 200 && tile.complete === true,
    `${target.name}: ${JSON.stringify(tile && { hasImg: tile.hasImg, nw: tile.nw, nh: tile.nh, complete: tile.complete, box: tile.imgBox, tile: tile.tile })}`,
  );
  claim(
    "it is painted, not merely present",
    !!tile && tile.visibility === "visible" && tile.opacity === "1" && tile.objectFit === "cover",
    `visibility=${tile?.visibility} opacity=${tile?.opacity} object-fit=${tile?.objectFit} display=${tile?.display}`,
  );
  claim(
    "the target is thumb-sized (>= 44x44 CSS px for the tile)",
    !!tile && tile.tile.w >= 44 && tile.tile.h >= 44,
    `tile ${tile?.tile?.w}x${tile?.tile?.h}, img ${tile?.imgBox?.w}x${tile?.imgBox?.h}`,
  );
  claim(
    "name and price legible BESIDE the photograph, not over it",
    !!tile && tile.overlaps === false && !!tile.nameFont,
    `overlaps=${tile?.overlaps} font=${tile?.nameFont} colour=${tile?.nameColor} text="${tile?.text}"`,
  );
  const bare = g.tiles?.find((x) => !x.hasImg);
  claim(
    "an unphotographed dish in the same grid renders cleanly, no broken glyph",
    !!bare && bare.placeholder === true && bare.error === false,
    `${bare?.name}: placeholder=${bare?.placeholder} error=${bare?.error}`,
  );
  claim("no broken-image glyph anywhere on the grid", g.errors === 0, `${g.errors} error glyphs / ${g.count} tiles`);
  claim("the grid is not ragged", g.heights.length === 1, `distinct tile heights: ${JSON.stringify(g.heights)}`);
  claim("no sideways scroll at 1440", g.overflowX === false, `overflowX=${g.overflowX}`);

  // ── RELOAD: does it persist for the cashier? ──
  await cash.reload({ waitUntil: "domcontentloaded" });
  await cash.waitForTimeout(7000);
  const g2 = await probeGrid(cash);
  const tile2 = g2.tiles?.find((x) => x.name === target.name);
  claim(
    "PERSISTS across a hard reload of the till",
    !!tile2 && tile2.hasImg && tile2.nw === 320,
    `after reload: hasImg=${tile2?.hasImg} nw=${tile2?.nw} errors=${g2.errors}`,
  );
  await snap(cash, "06-cashier-till-after-reload");

  // ── TAP the photographed tile ──
  const before = await cash.evaluate(() => document.body.innerText.includes("Charge Now"));
  await cash.locator(`button:has-text("${target.name}")`).first().click();
  await cash.waitForTimeout(1800);
  // A required modifier group opens a chooser — drive it through if present.
  const dlg = cash.locator('[role="dialog"]');
  if (await dlg.count()) {
    const opts = dlg.locator('button[role="radio"], [role="radio"], input[type="radio"]');
    if (await opts.count()) {
      await opts.first().click();
      await cash.waitForTimeout(400);
    }
    const add = dlg.getByRole("button", { name: /add|confirm|done/i }).first();
    if (await add.count()) {
      await add.click();
      await cash.waitForTimeout(1500);
    }
  }
  await snap(cash, "07-tapped");
  const cart = await cash.evaluate((nm) => {
    const txt = document.body.innerText;
    const badge = document.querySelector(`[data-testid^="menu-item-qty-"]`);
    const charge = Array.from(document.querySelectorAll("button")).find((b) =>
      /charge now/i.test(b.textContent || ""),
    );
    return {
      occurrences: (txt.match(new RegExp(nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
      badge: badge?.textContent?.trim() ?? null,
      chargeEnabled: charge ? !charge.disabled : null,
      emptyCopyGone: !/cart is empty|no items/i.test(txt),
    };
  }, target.name);
  claim(
    "tapping the photographed tile still adds the line",
    cart.occurrences >= 2 && cart.chargeEnabled === true && cart.emptyCopyGone,
    JSON.stringify(cart) + ` (charge-before=${before})`,
  );

  // ───────────────────────────── 3. THE WAITER (adjacent persona) ────────────
  const waiterPerson = { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" };
  const wtr = await newPage(browser);
  await login(wtr, waiterPerson);
  const wtrTok = await tokenOf(wtr);
  const wImg = await rawGet(wtr, target.url, wtrTok);
  t = await go(wtr, "/app/pos", { waitMs: 6000 });
  await wtr.waitForTimeout(3000);
  const wg = await probeGrid(wtr);
  const wTile = wg.tiles?.find((x) => x.name === target.name);
  await snap(wtr, "08-waiter-till");
  claim(
    "the WAITER's till also renders the photograph (adjacent persona)",
    wImg.status === 200 && !!wTile && wTile.hasImg && wTile.nw === 320 && wg.errors === 0,
    `image ${wImg.status}; tile hasImg=${wTile?.hasImg} nw=${wTile?.nw}; ${wg.errors} error glyphs / ${wg.count} tiles; page=${JSON.stringify(t.bad)}`,
  );

  // ───────────────────────────── 4. ANOTHER TENANT ───────────────────────────
  const cb = { slug: "control-bistro-isolation-test-tenant", email: "manager@control.local", password: "Control#Manager1" };
  const other = await newPage(browser);
  await login(other, cb);
  const otherTok = await tokenOf(other);
  const xTenant = await rawGet(other, target.url, otherTok);
  claim(
    "another TENANT cannot read Floating Terrace's menu picture",
    xTenant.status === 404,
    `control-bistro manager → ${xTenant.status} (len=${xTenant.len})`,
  );
  const xCashier = { slug: "control-bistro-isolation-test-tenant", email: "cashier@control.local", password: "Control#Cashier1" };
  const other2 = await newPage(browser);
  await login(other2, xCashier);
  const x2 = await rawGet(other2, target.url, await tokenOf(other2));
  claim(
    "another tenant's CASHIER cannot read it either",
    x2.status === 404,
    `control-bistro cashier → ${x2.status} (len=${x2.len})`,
  );

  // ───────────────────────────── 5. A NON-MENU FILE, SAME TENANT ─────────────
  const filesRes = await apiGet(mgr, "/api/v1/files?page=0&size=50", await tokenOf(mgr));
  const fileRows = filesRes.body?.data?.content ?? filesRes.body?.data ?? [];
  const menuFileIds = new Set(
    items2.filter((i) => i.imageUrl).map((i) => i.imageUrl.split("/").pop()),
  );
  const nonMenu = (Array.isArray(fileRows) ? fileRows : []).find(
    (f) => !menuFileIds.has(f.fileId ?? f.id),
  );
  if (nonMenu) {
    const nmId = nonMenu.fileId ?? nonMenu.id;
    const nmRes = await rawGet(cash, `/api/v1/pos/menu/images/${nmId}`, cashTok);
    claim(
      "a real file in the SAME tenant that is not a menu picture is refused",
      nmRes.status === 404,
      `file ${nmId} (${nonMenu.originalFilename ?? nonMenu.filename ?? "?"}) → ${nmRes.status}`,
    );
  } else {
    claim(
      "a real file in the SAME tenant that is not a menu picture is refused",
      false,
      `SKIPPED — /api/v1/files returned ${filesRes.status} with ${Array.isArray(fileRows) ? fileRows.length : "?"} rows`,
    );
  }

  // ───────────────────────────── 6. RESPONSIVE ───────────────────────────────
  for (const w of [390, 768]) {
    await cash.setViewportSize({ width: w, height: 844 });
    await cash.waitForTimeout(2500);
    const rg = await probeGrid(cash);
    const rt = rg.tiles?.find((x) => x.name === target.name);
    await snap(cash, `09-till-${w}`);
    claim(
      `${w}px: photograph renders, tile touchable, no sideways scroll`,
      !!rt && rt.hasImg && rt.tile.h >= 44 && rg.overflowX === false,
      `tile ${rt?.tile?.w}x${rt?.tile?.h} img ${rt?.imgBox?.w}x${rt?.imgBox?.h} overflowX=${rg.overflowX}`,
    );
  }

  writeFileSync(`${OUT}/_reopen-claims.json`, JSON.stringify({ target, results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} claims passed`);
  if (failed.length) console.log("  FAILED:\n" + failed.map((f) => `   - ${f.name}: ${f.detail}`).join("\n"));
  await browser.close();
}

run().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  writeFileSync(`${OUT}/_reopen-claims.json`, JSON.stringify({ error: String(e), results }, null, 2));
  process.exit(1);
});
