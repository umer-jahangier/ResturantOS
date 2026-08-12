/*
 * S7 PROOF — a menu item's photograph reaches the till.
 *
 * Drives the exact path in DONE MEANS, as the two people who actually walk it:
 *   1. manager@terrace.local uploads a picture to a dish that has none.
 *   2. cashier@terrace.local opens /app/pos and works the grid.
 *
 * Every visual claim is read from COMPUTED geometry and computed style — never from a class
 * list. `cn()`/tailwind-merge has silently dropped utility classes in this repo before, so a
 * class in the source is not a fact about the screen.
 */
import {
  newBrowser,
  newPage,
  login,
  PEOPLE,
  BASE,
  go,
  apiGet,
  tokenOf,
} from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S7");
mkdirSync(OUT, { recursive: true });
const results = [];
function claim(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function loginRetry(page, who, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await login(page, who);
    } catch (e) {
      if (i === tries) throw e;
      console.log(`    login retry ${i} (${(await page.evaluate(() => document.body.innerText)).slice(0, 90).replace(/\n/g, " ")})`);
      await page.waitForTimeout(3000 * i);
    }
  }
}

async function snap(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`    shot: ${name}.png`);
}

/** A real PNG, so file-service's magic-byte check passes. Distinct colour per call. */
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
const FIXTURE = makePng(`${SCRATCH}/s7-dish.png`, 240, 180, [198, 84, 34]);

/**
 * The till grid, read the way a person reads it: rendered pixels and resolved colours.
 * `overlapsImage` is what decides whether the name is legible OVER a photograph or BESIDE it —
 * a caption sitting on top of an unknown image is a contrast gamble; one below it is not.
 */
async function probeTill(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="menu-grid"]');
    if (!grid) return { grid: false };
    const tiles = Array.from(grid.children);
    const read = (cell) => {
      const btn = cell.querySelector("button");
      const img = cell.querySelector('[data-testid="menu-item-image"]');
      const ph = cell.querySelector('[data-testid="menu-item-image-placeholder"]');
      const err = cell.querySelector('[data-testid="menu-item-image-error"]');
      const bRect = btn?.getBoundingClientRect();
      const iRect = img?.getBoundingClientRect();
      const nameEl = btn?.querySelector("span > span");
      const nRect = nameEl?.getBoundingClientRect();
      const nStyle = nameEl ? getComputedStyle(nameEl) : null;
      const iStyle = img ? getComputedStyle(img) : null;
      const overlaps =
        iRect && nRect
          ? nRect.left < iRect.right &&
            nRect.right > iRect.left &&
            nRect.top < iRect.bottom &&
            nRect.bottom > iRect.top
          : false;
      return {
        text: (btn?.innerText || "").replace(/\n/g, " · "),
        name: nameEl?.textContent ?? null,
        tile: bRect && { w: Math.round(bRect.width), h: Math.round(bRect.height), top: Math.round(bRect.top) },
        img: iRect && {
          alt: img.alt,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          w: Math.round(iRect.width),
          h: Math.round(iRect.height),
          objectFit: iStyle.objectFit,
          display: iStyle.display,
          visibility: iStyle.visibility,
          opacity: iStyle.opacity,
        },
        nameStyle: nStyle && {
          fontSize: nStyle.fontSize,
          color: nStyle.color,
          visibility: nStyle.visibility,
          opacity: nStyle.opacity,
          w: Math.round(nRect.width),
          h: Math.round(nRect.height),
        },
        overlapsImage: overlaps,
        hasPlaceholder: !!ph,
        hasError: !!err,
      };
    };
    return {
      grid: true,
      tiles: tiles.length,
      imgs: grid.querySelectorAll('[data-testid="menu-item-image"]').length,
      painted: Array.from(grid.querySelectorAll("img")).filter((i) => i.naturalWidth > 0).length,
      errors: grid.querySelectorAll('[data-testid="menu-item-image-error"]').length,
      placeholders: grid.querySelectorAll('[data-testid="menu-item-image-placeholder"]').length,
      cells: tiles.map(read),
    };
  });
}

const browser = await newBrowser();
let dishName = null;
let expectedUrl = null;

// ══ 1. MANAGER uploads a picture ═════════════════════════════════════════════
{
  const page = await newPage(browser);
  await loginRetry(page, PEOPLE.manager);
  const t = await go(page, "/app/menu/items", { waitMs: 6000 });
  if (t.bad.length) throw new Error(`menu items page in trouble: ${t.bad.join(",")}`);
  await snap(page, "P1-manager-menu-items-before");

  const token = await tokenOf(page);
  const before = await apiGet(page, "/api/v1/pos/menu/items?size=500", token);
  const rows = before.body?.data ?? [];
  // A dish with NO picture, so the whole upload path is actually driven rather than re-observed.
  const target = rows.find((r) => !r.imageUrl && r.active && /^[A-Za-z]/.test(r.name));
  dishName = target.name;
  console.log(`  target dish: "${dishName}" (imageUrl currently ${target.imageUrl})`);

  await page.locator(`button[aria-label*="Actions for ${dishName}"]`).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("menuitem", { name: /^Edit$/i }).first().click();
  await page.waitForTimeout(2500);
  await snap(page, "P2-edit-dialog");

  await page.locator('[role="dialog"] input[type=file]').first().setInputFiles(FIXTURE);
  await page.waitForTimeout(4000);
  await snap(page, "P3-picture-chosen");

  await page
    .locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Save")')
    .first()
    .click();
  await page.waitForTimeout(6000);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  await snap(page, "P4-manager-after-reload");

  const after = await apiGet(page, "/api/v1/pos/menu/items?size=500", await tokenOf(page));
  const saved = (after.body?.data ?? []).find((r) => r.name === dishName);
  expectedUrl = saved?.imageUrl;
  claim(
    "manager upload persists and the API derives the menu route",
    !!expectedUrl && expectedUrl === `/api/v1/pos/menu/images/${saved.imageFileId}`,
    `imageUrl=${expectedUrl}`,
  );

  const shown = await page.evaluate(
    (n) =>
      Array.from(document.querySelectorAll('[data-testid="menu-item-image"]'))
        .filter((i) => i.alt === n)
        .map((i) => ({ alt: i.alt, nw: i.naturalWidth, nh: i.naturalHeight }))[0] ?? null,
    dishName,
  );
  claim(
    "the manager's own list paints the photograph after a full reload",
    !!shown && shown.nw === 240 && shown.nh === 180,
    JSON.stringify(shown),
  );
  await page.context().close();
}

// ══ 2. CASHIER opens the till ════════════════════════════════════════════════
{
  const page = await newPage(browser);
  await loginRetry(page, PEOPLE.cashier);

  // The cashier's own bearer against the picture URL — the read that used to be 403.
  await go(page, "/app/pos", { waitMs: 2000 });
  const token = await tokenOf(page);
  const direct = await page.evaluate(
    async ({ u, tok }) => {
      const r = await fetch(`http://localhost:8080${u}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      return { status: r.status, ct: r.headers.get("content-type"), cc: r.headers.get("cache-control") };
    },
    { u: expectedUrl, tok: token },
  );
  claim(
    "the cashier's own bearer fetches the picture (was 403 PERMISSION_DENIED)",
    direct.status === 200 && String(direct.ct).startsWith("image/"),
    JSON.stringify(direct),
  );

  // …and still cannot read the tenant's files at large.
  const fileRoute = await page.evaluate(
    async (tok) => {
      const r = await fetch(
        "http://localhost:8080/api/v1/files/00000000-0000-4000-8000-000000000000/download",
        { headers: { Authorization: `Bearer ${tok}` } },
      );
      return r.status;
    },
    token,
  );
  claim(
    "the cashier still holds no tenant-wide file read",
    fileRoute === 403,
    `GET /api/v1/files/{id}/download → ${fileRoute}`,
  );

  // ── the grid, before and after the photographs resolve (layout shift) ──
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="menu-grid"]', { timeout: 20000 });
  const early = await probeTill(page);
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[data-testid="menu-grid"] img')).some(
        (i) => i.naturalWidth > 0,
      ),
    { timeout: 20000 },
  );
  await page.waitForTimeout(2500);
  const late = await probeTill(page);
  await snap(page, "P5-cashier-till-1440");

  const shot = late.cells.find((c) => c.name === dishName);
  const plain = late.cells.find((c) => c.name !== dishName && c.hasPlaceholder);

  claim(
    "the till grid renders the photograph on that dish's tile",
    !!shot?.img && shot.img.naturalWidth === 240 && shot.img.naturalHeight === 180,
    `${dishName}: ${JSON.stringify(shot?.img)}`,
  );
  claim(
    "the photograph is a thumb-sized target inside a thumb-sized tile",
    !!shot && shot.img.w >= 100 && shot.img.h >= 70 && shot.tile.h >= 100 && shot.tile.w >= 100,
    `img ${shot?.img.w}×${shot?.img.h} in tile ${shot?.tile.w}×${shot?.tile.h}`,
  );
  claim(
    "the picture is painted, not merely present",
    !!shot &&
      shot.img.display !== "none" &&
      shot.img.visibility === "visible" &&
      Number(shot.img.opacity) === 1 &&
      shot.img.objectFit === "cover",
    `display=${shot?.img.display} visibility=${shot?.img.visibility} opacity=${shot?.img.opacity} object-fit=${shot?.img.objectFit}`,
  );
  claim(
    "the name and price stay legible BESIDE the photograph, never over it",
    !!shot &&
      shot.overlapsImage === false &&
      shot.nameStyle.visibility === "visible" &&
      Number(shot.nameStyle.opacity) === 1 &&
      parseFloat(shot.nameStyle.fontSize) >= 12 &&
      shot.text.includes(dishName) &&
      /\d/.test(shot.text),
    `overlaps=${shot?.overlapsImage} font=${shot?.nameStyle.fontSize} colour=${shot?.nameStyle.color} text="${shot?.text}"`,
  );
  claim(
    "a dish with no picture renders cleanly in the same grid",
    !!plain && !plain.img && !plain.hasError && plain.hasPlaceholder,
    `${plain?.name}: placeholder=${plain?.hasPlaceholder} error=${plain?.hasError} img=${!!plain?.img}`,
  );
  claim(
    "no tile is a broken image",
    late.errors === 0,
    `${late.errors} error glyphs across ${late.tiles} tiles`,
  );
  claim(
    "the grid is not ragged — every tile is the same height",
    new Set(late.cells.map((c) => c.tile.h)).size === 1,
    `heights: ${JSON.stringify([...new Set(late.cells.map((c) => c.tile.h))])}`,
  );

  const shifted = early.cells
    .map((c, i) => [c.tile?.h, late.cells[i]?.tile?.h])
    .filter(([a, b]) => a !== b);
  claim(
    "no layout shift as the photographs arrive",
    early.tiles === late.tiles && shifted.length === 0,
    `${early.tiles} tiles before / ${late.tiles} after, ${shifted.length} changed height`,
  );

  // ── the tile still does its job ──
  const tileIndex = late.cells.findIndex((c) => c.name === dishName);
  await page.locator('[data-testid="menu-grid"] > div').nth(tileIndex).locator("button").first().click();
  await page.waitForTimeout(2500);
  await snap(page, "P6a-tapped-the-tile");

  /*
   * The tile is the START of ordering, not necessarily the whole of it: a dish carrying a
   * required modifier group opens the chooser first (S6's modifier catalogue). Driving that
   * through is the honest version of "tap the tile and confirm it still adds the line" — the
   * first run of this harness asserted a bare qty badge, saw none, and would have reported a
   * regression that was actually a correct required-option dialog. The screenshot said so.
   */
  const dialog = page.locator('[role="dialog"]');
  const viaModifier = (await dialog.count()) > 0;
  if (viaModifier) {
    const required = dialog.locator("text=/Required — choose exactly/i");
    if (await required.count()) {
      // Pick the first option of every required group.
      const groups = await dialog.locator("button", { hasText: /^(?!Cancel|Add to order).+/ }).all();
      for (const g of groups.slice(0, 1)) await g.click().catch(() => {});
    }
    await page.waitForTimeout(600);
    await dialog.getByRole("button", { name: /Add to order/i }).click();
    await page.waitForTimeout(2500);
  }
  await snap(page, "P6b-line-in-the-cart");

  const added = await page.evaluate((n) => {
    const cart = document.body.innerText;
    const dialogOpen = !!document.querySelector('[role="dialog"]');
    return {
      dialogOpen,
      qtyBadge: document.querySelector('[data-testid^="menu-item-qty-"]')?.textContent ?? null,
      mentions: cart.split(n).length - 1,
      chargeEnabled: !!Array.from(document.querySelectorAll("button")).find(
        (b) => /Charge Now/i.test(b.textContent || "") && !b.disabled,
      ),
      emptyCopyGone: !cart.includes("Add items to start an order"),
    };
  }, dishName);
  claim(
    "tapping the photographed tile still adds the line",
    added.dialogOpen === false && added.emptyCopyGone && added.mentions >= 2 && added.chargeEnabled,
    `${viaModifier ? "via the required-modifier chooser" : "directly"}; ` +
      `name on screen ${added.mentions}× (tile + cart line), empty-cart copy gone=${added.emptyCopyGone}, ` +
      `Charge Now enabled=${added.chargeEnabled}, qty badge=${added.qtyBadge}`,
  );

  await page.context().close();
}

// ══ 3. Responsive + both themes ══════════════════════════════════════════════
for (const [w, h, label] of [
  [390, 844, "390"],
  [768, 1024, "768"],
  [1440, 950, "1440"],
]) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    const page = await ctx.newPage();
    await loginRetry(page, PEOPLE.cashier);
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="menu-grid"]', { timeout: 25000 });
    await page
      .waitForFunction(
        () =>
          Array.from(document.querySelectorAll('[data-testid="menu-grid"] img')).some(
            (i) => i.naturalWidth > 0,
          ),
        { timeout: 20000 },
      )
      .catch(() => {});
    await page.waitForTimeout(2000);
    const probe = await probeTill(page);
    const shot = probe.cells?.find((c) => c.name === dishName);
    const page_ = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="menu-grid"]');
      return {
        gridW: Math.round(g?.getBoundingClientRect().width ?? -1),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        // A page that scrolls sideways is a broken page. Measured, not assumed.
        overflowsX: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    await snap(page, `P7-${label}-${scheme}`);
    /*
     * What this claim does and does NOT say.
     *
     * It says: at this width and in this theme the photograph resolves, the tile keeps a
     * touchable height, the theme's own surface colour is in force, and the page does not
     * scroll sideways.
     *
     * It does NOT say the till is comfortable at 390 or 768 — how much room the menu column gets
     * is the POS terminal's layout, not this change's. Measured here at 11:33 on 2026-08-12, that
     * column was 37px wide at 390 and 159px at 768, IDENTICALLY with photographs ON and OFF,
     * which is how we know the squeeze was never about images; by 11:52 a sibling change had
     * widened it to 358px and 480px. Either way the number is REPORTED rather than asserted, so
     * this tick can never silently start meaning "the POS is responsive".
     */
    claim(
      `${label}px ${scheme}: the photograph renders, the tile stays touchable, no sideways scroll`,
      !!shot?.img && shot.img.naturalWidth > 0 && shot.tile.h >= 100 && !page_.overflowsX,
      `tile ${shot?.tile.w}×${shot?.tile.h}, img ${shot?.img.w}×${shot?.img.h}, ` +
        `menu column ${page_.gridW}px (the POS layout's own width, not this change's), ` +
        `body bg ${page_.bodyBg}, overflow-x=${page_.overflowsX}`,
    );
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} claims passed`);
writeFileSync(`${OUT}/_s7-claims.json`, JSON.stringify(results, null, 2));
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
