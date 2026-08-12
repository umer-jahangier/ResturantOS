/*
 * Shared driving helpers for S1 #13 / repair item S1-08 —
 * "86'ing an item does not reach tills that are already open".
 *
 * Two browser contexts run side by side: MANAGER on /app/menu/items (the actor) and
 * CASHIER on /app/pos (the observer). Nothing in here reloads the cashier — the whole
 * point of the gap is whether the till updates WITHOUT a reload, so any navigation on
 * the observer side would destroy the measurement.
 *
 * probeTill() reads the REAL DOM of the running terminal and reports [role=alert] /
 * loading first, because this repo has repeatedly mistaken a failed read rendered as an
 * empty grid for a passing empty state.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const SLUG = "floating-terrace";

export const MANAGER = { slug: SLUG, email: "manager@terrace.local", password: "Terrace#Manager1" };
export const CASHIER = { slug: SLUG, email: "cashier@terrace.local", password: "Terrace#Cashier1" };

export const TARGET_ITEM = process.env.S1_ITEM ?? "Butter Naan";

export function outDir(sub) {
  const dir = resolve(process.cwd(), "../.planning/audits/repair/S1-08", sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function shot(page, dir, name) {
  const file = `${dir}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log("    shot:", `${name}.png`);
  return file;
}

/**
 * Signs a persona in through the real form, with retries.
 *
 * The retry is not padding. Four contexts sign in within a few seconds of each other while
 * nine other agents drive the same gateway, and the gateway rate-limits: a single-shot login
 * fails intermittently with 429 and the page simply stays on /login. Reporting that as
 * "manager cannot sign in" would be a fabricated finding — so the failure is retried and, if
 * it still fails, reported WITH the error the page is actually showing.
 */
export async function login(page, who, attempts = 6) {
  let lastError = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } catch (e) {
      // The Next dev server recompiles constantly while ten agents edit the same tree; a
      // navigation timeout here is the toolchain, not the product.
      console.log(`    login attempt ${i + 1}: navigation failed (${e.message.split("\n")[0]})`);
      await page.waitForTimeout(5000);
      continue;
    }
    const email = page.locator('input[name="email"], input#email').first();
    await email.waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1500);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await email.fill(who.email);
    const pw = page.locator('input[name="password"], input#password').first();
    await pw.fill(who.password);
    // Read the fields BACK. A fill that lands before React hydrates is silently discarded,
    // and the form then reports "Enter a valid email address | Password is required" —
    // which reads exactly like a real validation defect and is not one.
    const filled = await page.evaluate(() => {
      const e = document.querySelector('input[name="email"], input#email');
      const p = document.querySelector('input[name="password"], input#password');
      return { email: e?.value ?? "", pw: (p?.value ?? "").length };
    });
    if (filled.email !== who.email || filled.pw === 0) {
      console.log(`    login attempt ${i + 1}: fields did not stick (email="${filled.email}") — retrying`);
      await page.waitForTimeout(3000);
      continue;
    }
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
    if (!page.url().includes("/login")) return;
    lastError = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"], .text-destructive'))
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .join(" | "),
    );
    console.log(`    login attempt ${i + 1} for ${who.email} failed: ${lastError || "(no visible error)"}`);
    await page.waitForTimeout(4000 * (i + 1));
  }
  throw new Error(`login failed for ${who.email} after ${attempts} attempts: ${lastError || "(no visible error)"}`);
}

/** Opens the cashier's till if it is closed — the terminal (and therefore the menu grid)
 *  does not render at all without an OPEN drawer. */
export async function ensureTillOpen(page) {
  const notice = page.locator('[data-testid="pos-till-closed-notice"]');
  await page.waitForTimeout(1500);
  if ((await notice.count()) === 0) return "already-open";
  const btn = page.locator('[data-testid="open-till-button"]');
  if ((await btn.count()) === 0) return "no-open-button";
  await btn.first().click();
  await page.waitForTimeout(600);
  const panel = page.locator('[data-testid="open-till-panel"]');
  const input = panel.locator("input").first();
  if (await input.count()) await input.fill("500000");
  await page.locator('[data-testid="open-till-confirm-button"]').first().click();
  await page.waitForTimeout(3000);
  return (await notice.count()) === 0 ? "opened" : "still-closed";
}

/**
 * Everything the cashier can actually see on the terminal, straight out of the DOM.
 * `tiles` is every menu tile physically present in the grid with the text it shows and
 * whether it is disabled/unavailable.
 */
export async function probeTill(page, itemName) {
  return page.evaluate((needle) => {
    const txt = (n) => (n?.textContent ?? "").trim();
    const grid = document.querySelector('[data-testid="menu-grid"]');
    const tiles = Array.from(grid?.querySelectorAll("button[aria-pressed]") ?? []).map((b) => ({
      label: txt(b.querySelector("span")),
      disabled: b.disabled === true,
      ariaDisabled: b.getAttribute("aria-disabled"),
      unavailable: b.getAttribute("data-unavailable"),
      pointerEvents: getComputedStyle(b).pointerEvents,
      opacity: getComputedStyle(b).opacity,
    }));
    const match = tiles.find((t) => t.label.toLowerCase().includes(needle.toLowerCase()));
    // Sonner renders into an [aria-live] region and auto-dismisses in ~4s, so this is only
    // ever caught by an EARLY mark — the +2s mark routinely misses it, which is why the
    // proof takes a +1s reading as well.
    const toasts = Array.from(document.querySelectorAll("[data-sonner-toast], li[data-sonner-toast]"))
      .map(txt)
      .filter(Boolean);
    return {
      toasts,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(txt).filter(Boolean),
      tillClosed: !!document.querySelector('[data-testid="pos-till-closed-notice"]'),
      gridPresent: !!grid,
      count: txt(document.querySelector('[data-testid="menu-item-count"]')),
      badge: txt(document.querySelector('[data-testid="pos-connection-badge"]')),
      n: tiles.length,
      target: match ?? null,
      labels: tiles.map((t) => t.label),
    };
  }, itemName);
}

export function fmt(p) {
  const t = p.target
    ? `PRESENT(disabled=${p.target.disabled} ariaDisabled=${p.target.ariaDisabled} unavail=${p.target.unavailable} pe=${p.target.pointerEvents})`
    : "ABSENT";
  return `grid=${p.gridPresent} tiles=${p.n} count="${p.count}" alerts=${p.alerts.length} toasts=${JSON.stringify(p.toasts)} → target ${t}`;
}

/**
 * Toggles the named item from the manager's Menu Items page via its row action menu, and
 * CONFIRMS the toggle actually landed before returning.
 *
 * <p>The confirmation is the point. The gateway rate-limits, and with nine other agents
 * driving this stack a menu PATCH comes back `429 Too Many Requests` often enough to matter —
 * measured: the reactivate leg of a proof run failed with the product correctly showing
 * "Request failed with status code 429", and a harness that only asserted "I clicked
 * Reactivate" would have reported the live-propagation feature broken on the strength of a
 * rate limiter. So the row's own Inactive badge is read back, and a refused toggle is retried.
 */
export async function toggleItem(page, itemName, attempts = 4) {
  let label = "?";
  for (let i = 0; i < attempts; i += 1) {
    const before = await readRowState(page, itemName);
    const trigger = page.locator(`button[aria-label="Actions for ${itemName}"]`);
    await trigger.first().waitFor({ state: "visible", timeout: 15000 });
    await trigger.first().click();
    await page.waitForTimeout(600);
    const entry = page.locator('[role="menuitem"]', { hasText: /^(Deactivate|Reactivate)$/ });
    label = (await entry.first().textContent())?.trim() ?? "?";
    await entry.first().click();
    // Short: the observer's toast auto-dismisses in ~4s, so the actor must not burn that
    // window before the observer is polled.
    await page.waitForTimeout(900);

    const after = await readRowState(page, itemName);
    const rateLimited = await page.evaluate(() =>
      /429|Too Many Requests/i.test(document.body.innerText),
    );
    // "missing" after a Deactivate is SUCCESS, not failure: the Menu Items page hides inactive
    // rows unless "Show inactive" is ticked, so the row correctly leaves the default view. It
    // is only a failure when the row was already absent before the click.
    if (after !== before) return label;
    console.log(
      `    toggle "${itemName}" attempt ${i + 1}: state ${before} → ${after}` +
        (rateLimited ? " (429 seen on screen)" : ""),
    );
    await page.waitForTimeout(6000 * (i + 1));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const showInactive = page.locator('input[type="checkbox"]').first();
    if ((await showInactive.count()) && before === "inactive") await showInactive.check();
    await page.waitForTimeout(1500);
  }
  throw new Error(`toggle for "${itemName}" never took effect (last click: ${label})`);
}

/** "active" | "inactive" | "missing" — read from the row's own Inactive badge. */
export async function readRowState(page, itemName) {
  return page.evaluate((name) => {
    const rows = Array.from(document.querySelectorAll("div")).filter((d) => {
      const span = d.querySelector(":scope > span.flex-1");
      return span && span.textContent?.trim() === name;
    });
    if (rows.length === 0) return "missing";
    return rows[0].textContent?.includes("Inactive") ? "inactive" : "active";
  }, itemName);
}

/** Polls the observer at +2/+5/+10/+20s without touching it. */
export async function watch(page, itemName, dir, tag, marks = [2, 5, 10, 20]) {
  const out = [];
  let elapsed = 0;
  for (const m of marks) {
    await page.waitForTimeout((m - elapsed) * 1000);
    elapsed = m;
    const p = await probeTill(page, itemName);
    console.log(`    +${m}s  ${fmt(p)}`);
    out.push({ t: m, ...p });
    if (dir) await shot(page, dir, `${tag}-plus${m}s`);
  }
  return out;
}
