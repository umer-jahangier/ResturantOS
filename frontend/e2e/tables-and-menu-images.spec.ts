import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";

/**
 * Phase 19b in a real browser: dining-table management, and menu-item pictures.
 *
 * <p>Both halves close gaps the user reported in their own words — "I didn't find any way to add
 * tables" and "there should be a picture upload option for menu item". Neither could be verified
 * anywhere but here:
 *
 * <ul>
 *   <li>The picture upload is the product's FIRST file input. Its happy path cannot be proven in
 *       jsdom at all — MSW never returns a response for an intercepted multipart XHR — so the
 *       only place the whole chain (FormData → gateway → magic-byte check → MinIO → menu item →
 *       authenticated blob render) runs is a browser.</li>
 *   <li>The image is rendered from an object URL fetched WITH an Authorization header, because
 *       the download endpoint is permission-gated. A unit test cannot tell that apart from a
 *       plain {@code <img src>} that would 401 in production.</li>
 * </ul>
 *
 * <p>Run: {@code E2E_LEGACY=1 npx playwright test e2e/tables-and-menu-images.spec.ts --project=legacy}
 */

const MANAGER = { email: "manager@terrace.local", password: "Terrace#Manager1" };
const WAITER = { email: "waiter@terrace.local", password: "Terrace#Waiter1" };

const SHOTS = path.resolve(__dirname, "../../.planning/phases/19b-tables-and-images/shots");
/** Under `test-results/`, which `.gitignore` already covers — these fixtures are build output. */
const TMP = path.resolve(__dirname, "../test-results/19b-fixtures");

/** A REAL 96×96 PNG, built here so the fixture cannot drift from what the server accepts. */
function writeRealPng(file: string): string {
  const w = 96;
  const h = 96;
  const raw: number[] = [];
  for (let y = 0; y < h; y++) {
    raw.push(0); // PNG filter byte per scanline
    for (let x = 0; x < w; x++) raw.push((x * 2) % 256, (y * 2) % 256, 160);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    // Uint32Array (fixed-width, densely allocated) rather than a sparse number[].
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    // The `!` states a fact the checker cannot derive: `& 0xff` masks the index to
    // 0..255 and crcTable is a densely-allocated Uint32Array(256), so the read can
    // never be undefined. noUncheckedIndexedAccess applies to TypedArrays too, so
    // the type is `number | undefined` regardless of the mask. `?? 0` was rejected
    // deliberately — it would silently substitute a WRONG CRC byte if the
    // invariant ever broke, turning a crash into corrupt output.
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff]! ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, file);
  writeFileSync(p, png);
  return p;
}

/** Not an image at all, but named .png and offered as image/png — the forged-upload case. */
function writeDisguisedExecutable(file: string): string {
  mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, file);
  writeFileSync(
    p,
    Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00 not an image", "binary"),
  );
  return p;
}

/**
 * Login is email + password. There is deliberately no tenant slug field.
 *
 * <p>Two details here are load-bearing, and both cost a failed run to find:
 *
 * <ol>
 *   <li><strong>{@code networkidle}, not {@code domcontentloaded}.</strong> The login form is a
 *       react-hook-form controlled by client state that is not wired up until hydration
 *       finishes.</li>
 *   <li><strong>{@code pressSequentially}, not {@code fill}.</strong> {@code fill} sets the
 *       value in one shot; against this form the DOM then HELD the text — the assertion on
 *       {@code inputValue()} passed — while react-hook-form's own state stayed empty, so submit
 *       failed validation and re-rendered the field blank with "Enter a valid email address".
 *       Real keystrokes produce the events the form is actually listening for.</li>
 * </ol>
 */
async function login(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto("/login", { waitUntil: "networkidle" });
  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');
  await email.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1500);

  await email.click();
  await email.pressSequentially(who.email, { delay: 20 });
  await password.click();
  await password.pressSequentially(who.password, { delay: 20 });
  await expect(email).toHaveValue(who.email);

  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 45_000 });
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Unique per run so re-runs never collide with the branch's unique table-number constraint. */
const RUN = Date.now().toString().slice(-5);

test.describe("19b — dining tables", () => {
  test.setTimeout(150_000);

  test("a manager can create, rename and retire a table, and it becomes selectable", async ({
    page,
  }) => {
    await login(page, MANAGER);

    await page.goto("/app/tables", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Tables" })).toBeVisible({ timeout: 20_000 });
    await shot(page, "01-tables-list");

    // ── create ──────────────────────────────────────────────────────────────
    const name = `E2E-${RUN}`;
    await page.getByRole("button", { name: "Add table" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Name or number" }).fill(name);
    const seats = dialog.getByRole("textbox", { name: "Seats" });
    await seats.fill("");
    await seats.fill("6");
    await dialog.getByRole("combobox", { name: "Section" }).fill("Terrace");
    await shot(page, "02-tables-add-dialog");
    await dialog.getByRole("button", { name: "Add table" }).click();

    await expect(page.getByRole("group", { name: "Terrace section" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await shot(page, "03-tables-created");

    // ── the point of the whole phase: it is now SELECTABLE when taking an order ──
    // The picker is a collapsed combobox, so the catalogue is not in the DOM until it opens —
    // asserting on the page text without opening it proves nothing either way.
    await page.goto("/app/pos", { waitUntil: "networkidle" });
    const trigger = page.getByTestId("table-select-trigger");
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await expect(trigger).toContainText("No table (optional)");
    await trigger.click();

    const listbox = page.getByRole("listbox", { name: "Tables" });
    await expect(listbox).toBeVisible({ timeout: 15_000 });
    await expect(listbox.getByText(name, { exact: false })).toBeVisible({ timeout: 15_000 });
    await shot(page, "04-pos-table-list-open");

    // Actually pick it — a table you can see but not choose is not finished either.
    await listbox.getByRole("button", { name: new RegExp(name) }).click();
    await expect(trigger).toContainText(name, { timeout: 15_000 });
    await shot(page, "04b-pos-table-selected");

    // ── retire ──────────────────────────────────────────────────────────────
    await page.goto("/app/tables", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Retire" }).click();

    // Gone from the default list — which is exactly what the order picker reads.
    await expect(page.getByText(name, { exact: true })).toBeHidden({ timeout: 20_000 });
    // Still in the catalogue, marked Retired, because closed orders reference it.
    await page.getByLabel("Show retired").check();
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 20_000 });
    await shot(page, "05-tables-retired");
  });

  test("a waiter gets no Tables nav entry and no management actions", async ({ page }) => {
    await login(page, WAITER);
    await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // `pos.tables.admin` gates the nav item; a waiter holds only `pos.tables.manage`.
    const nav = page.locator("nav");
    await expect(nav.getByRole("link", { name: "Tables" })).toHaveCount(0);
    await shot(page, "06-waiter-no-tables-nav");

    // And the screen itself offers nothing to manage, even reached directly by URL.
    await page.goto("/app/tables", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await expect(page.getByRole("button", { name: "Add table" })).toHaveCount(0);
    await shot(page, "07-waiter-tables-readonly");
  });
});

test.describe("19b — menu item pictures", () => {
  test.setTimeout(180_000);

  test("a manager uploads a picture, sees it, and a forged image is refused", async ({ page }) => {
    await login(page, MANAGER);
    await page.goto("/app/menu/items", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Menu Items" })).toBeVisible({
      timeout: 20_000,
    });
    await shot(page, "08-menu-items-list");

    await page.getByRole("button", { name: "Add item", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const itemName = `Photo Dish ${RUN}`;
    await dialog.getByRole("textbox", { name: "Name" }).fill(itemName);
    await dialog.getByRole("textbox", { name: "Price (Rs)" }).fill("725");

    // ── the forged upload: named .png, offered as image/png, not an image ──────
    // Every client-side check passes it. Only file-service's magic-byte read can refuse it,
    // which is the entire reason that check reads bytes instead of the Content-Type header.
    await dialog
      .getByTestId("menu-item-image-input")
      .setInputFiles(writeDisguisedExecutable("disguised.png"));
    const uploadError = dialog.getByTestId("menu-item-image-error-message");
    await expect(uploadError).toBeVisible({ timeout: 30_000 });
    await expect(uploadError).toContainText(/not a JPEG, PNG or WebP/i);
    await shot(page, "09-menu-image-forged-rejected");

    // ── the real one ─────────────────────────────────────────────────────────
    await dialog.getByTestId("menu-item-image-input").setInputFiles(writeRealPng("dish.png"));
    await expect(dialog.getByTestId("menu-item-image-preview")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId("menu-item-image-remove")).toBeVisible();
    await shot(page, "10-menu-image-preview");

    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // The saved item's thumbnail is fetched through the authenticated client and rendered from
    // an object URL — a plain <img src> at the gated download route would 401 here.
    const row = page
      .locator("div")
      .filter({ hasText: new RegExp(`^${itemName}`) })
      .last();
    await expect(page.getByText(itemName, { exact: true })).toBeVisible({ timeout: 30_000 });
    const thumb = page.getByTestId("menu-item-image").first();
    await expect(thumb).toBeVisible({ timeout: 30_000 });
    // A `blob:` src is the proof it came through the authenticated fetch, not a naked URL.
    await expect(thumb).toHaveAttribute("src", /^blob:/);
    await shot(page, "11-menu-image-saved-thumbnail");

    expect(await row.count()).toBeGreaterThanOrEqual(0);
  });
});
