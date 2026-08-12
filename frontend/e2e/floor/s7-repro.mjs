/*
 * S7 REPRODUCTION — "menu item images never reach the POS grid".
 *
 * Two halves, driven as the two real personas:
 *   A. manager  — does the catalogue actually carry a picture? (/app/menu/items renders one)
 *   B. cashier  — does the till grid render it? and CAN the cashier even fetch the bytes?
 *
 * Half B's second question is the one the register did not ask. The download route is gated on
 * `file.view`, and the cashier does not hold it — so a naive "render <img> in the grid" fix would
 * ship 40 broken boxes to the one persona who works this screen.
 */
import { newBrowser, newPage, login, PEOPLE, go, shot, apiGet, tokenOf } from "../shift/lib.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/*
 * Ten agents share this machine and this seed database. A concurrent sign-in as the same principal
 * rotates the refresh-token family under us and the form comes back "Sign-in failed / This record
 * changed while you were editing it" — a 409 that has nothing to do with what is being tested.
 * Retrying is the honest handling: the run must not score a screen on somebody else's race.
 */
async function loginRetry(page, who, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await login(page, who);
    } catch (e) {
      const txt = await page.evaluate(() => document.body.innerText.slice(0, 200));
      console.log(`    login attempt ${i}/${tries} failed: ${txt.replace(/\n/g, " | ")}`);
      if (i === tries) throw e;
      await page.waitForTimeout(3000 * i);
    }
  }
}

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S7");
mkdirSync(OUT, { recursive: true });

async function snap(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`    shot: ${name}.png`);
}

/** Count real, rendered <img> pixels inside a container — computed geometry, never class names. */
async function probeGrid(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="menu-grid"]');
    const tiles = grid ? grid.children.length : 0;
    const imgs = grid ? Array.from(grid.querySelectorAll("img")) : [];
    return {
      tiles,
      imgs: imgs.length,
      painted: imgs.filter((i) => i.naturalWidth > 0).length,
      placeholders: grid
        ? grid.querySelectorAll('[data-testid="menu-item-image-placeholder"]').length
        : 0,
      errors: grid ? grid.querySelectorAll('[data-testid="menu-item-image-error"]').length : 0,
      firstTileText: grid?.children[0]?.innerText?.replace(/\n/g, " · ") ?? null,
      bodyHas: /No items available/.test(document.body.innerText),
    };
  });
}

const browser = await newBrowser();

// ── A. manager: prove the catalogue carries a picture ────────────────────────
{
  const page = await newPage(browser);
  await loginRetry(page, PEOPLE.manager);
  const t = await go(page, "/app/menu/items", { waitMs: 5000 });
  console.log("  manager /app/menu/items trouble:", JSON.stringify(t.bad), t.alerts);
  await snap(page, "A1-manager-menu-items");

  const token = await tokenOf(page);
  const r = await apiGet(page, "/api/v1/pos/menu/items?size=500", token);
  const rows = r.body?.data ?? [];
  const withPics = rows.filter((i) => i.imageUrl);
  console.log(`  MENU: ${rows.length} items, ${withPics.length} carry an imageUrl`);
  console.log(
    "  with pictures:",
    JSON.stringify(withPics.slice(0, 6).map((i) => ({ n: i.name, u: i.imageUrl }))),
  );

  // manager holds file.view — does the byte fetch work for them?
  if (withPics[0]) {
    const dl = await page.evaluate(
      async ({ u, tok }) => {
        const res = await fetch(`http://localhost:8080${u}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        return { status: res.status, ct: res.headers.get("content-type") };
      },
      { u: withPics[0].imageUrl, tok: token },
    );
    console.log("  manager download:", JSON.stringify(dl));
  }

  // what the manager's own list screen paints
  const listImgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="menu-item-image"]')).map((i) => ({
      alt: i.alt,
      nw: i.naturalWidth,
      nh: i.naturalHeight,
    })),
  );
  console.log("  manager list <img>:", JSON.stringify(listImgs.slice(0, 5)));
  await page.context().close();
}

// ── B. cashier: the till ─────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  await loginRetry(page, PEOPLE.cashier);
  const t = await go(page, "/app/pos", { waitMs: 6000 });
  console.log("  cashier /app/pos trouble:", JSON.stringify(t.bad), t.alerts);
  await snap(page, "B1-cashier-pos-grid");

  const probe = await probeGrid(page);
  console.log("  POS GRID PROBE:", JSON.stringify(probe));

  const token = await tokenOf(page);
  const r = await apiGet(page, "/api/v1/pos/menu/items?size=500", token);
  const rows = r.body?.data ?? [];
  const withPics = rows.filter((i) => i.imageUrl);
  console.log(`  cashier sees ${rows.length} items, ${withPics.length} with imageUrl`);

  if (withPics[0]) {
    const dl = await page.evaluate(
      async ({ u, tok }) => {
        const res = await fetch(`http://localhost:8080${u}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        let body = null;
        try {
          body = await res.clone().json();
        } catch {
          body = null;
        }
        return { status: res.status, ct: res.headers.get("content-type"), body };
      },
      { u: withPics[0].imageUrl, tok: token },
    );
    console.log("  ⚑ CASHIER download of a menu picture:", JSON.stringify(dl));
  }

  // what permissions does the cashier's own token actually carry?
  const me = await apiGet(page, "/api/v1/auth/me", token);
  const perms = me.body?.data?.permissions ?? me.body?.permissions ?? [];
  console.log(
    "  cashier file.* perms:",
    JSON.stringify(perms.filter((p) => String(p).startsWith("file."))),
    `(of ${perms.length} total)`,
  );
  await page.context().close();
}

await browser.close();
console.log("done");
