// S0-05 — Order search must reach the SERVER, across all statuses, by order no / table /
// customer phone. Run:  node e2e/diag/s0-05-order-search.mjs before|after
//
// Drives the real login form as manager@terrace.local, opens /app/pos → Order Management,
// leaves the "All" chip selected, and types the order number of a VOIDED order and of a
// CLOSED order into the search box. Records network requests to /api/v1/pos/orders so we
// can tell a server-side search from a stale local filter.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LABEL = process.argv[2] ?? "run";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-05", LABEL);
const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";

const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};

const log = [];
function say(...a) {
  const line = a.join(" ");
  console.log(line);
  log.push(line);
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  say("  shot ->", `${name}.png`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  // The tenant identifier field is behind a toggle now; the email domain resolves the
  // tenant on its own, so only reveal + fill it if the toggle is absent.
  const toggle = page.getByTestId("show-tenant-field");
  if ((await toggle.count()) === 0) {
    const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slugField.count()) await slugField.first().fill(MANAGER.slug);
  }
  await page.locator('input[name="email"]').first().fill(MANAGER.email);
  await page.locator('input[name="password"]').first().fill(MANAGER.password);
  await page.getByTestId("login-submit").click();
  await page.waitForTimeout(5000);
  return !page.url().includes("/login");
}

/** Rows currently rendered in the Order Management table, as text. */
async function rows(page) {
  return page.$$eval("table tbody tr", (trs) =>
    trs.map((tr) =>
      Array.from(tr.querySelectorAll("td"))
        .map((td) => td.innerText.replace(/\s+/g, " ").trim())
        .join(" | "),
    ),
  );
}

async function main() {
  // Fixture ids come from the environment: which orders are VOIDED / CLOSED and which
  // customer phone is attached is discovered by the caller and passed in as JSON.
  const fixture = JSON.parse(process.env.S0_05_FIXTURE ?? "{}");
  const { voidedNo, closedNo, phone, phoneOrderNo } = fixture;
  say(`fixture voided=${voidedNo} closed=${closedNo} phone=${phone} (${phoneOrderNo})`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  const netlog = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/v1/pos/orders")) netlog.push(u.replace(GW, ""));
  });
  page.on("pageerror", (e) => say("  ! page error:", String(e).slice(0, 160)));

  if (!(await login(page))) throw new Error("login failed: " + page.url());
  say("signed in as manager");

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: "Order Management" }).click();
  await page.waitForTimeout(3000);

  const alertCount = await page.locator('[role="alert"]').count();
  say(`role=alert on order management: ${alertCount}`);
  const baseRows = await rows(page);
  say(`ALL chip, empty search -> ${baseRows.length} rows rendered`);
  await shot(page, "01-all-chip-baseline");

  const search = page.getByTestId("order-management-search");

  async function probe(term, name) {
    netlog.length = 0;
    await search.fill("");
    await page.waitForTimeout(400);
    await search.fill(term);
    await page.waitForTimeout(2500);
    const r = await rows(page);
    const emptyState = await page.getByText("No active orders").count();
    const serverHits = netlog.filter((u) => u.includes("q=") || u.includes("search="));
    say(
      `search "${term}" -> rows=${r.length} emptyState=${emptyState} ` +
        `posOrdersRequests=${netlog.length} withQueryParam=${serverHits.length}`,
    );
    for (const line of r.slice(0, 5)) say(`     ${line}`);
    for (const u of netlog.slice(0, 6)) say(`     NET ${u}`);
    await shot(page, name);
    return { term, rows: r, emptyState, netlog: [...netlog], serverHits };
  }

  const results = {};
  if (voidedNo) results.voided = await probe(voidedNo, "02-search-voided");
  if (closedNo) results.closed = await probe(closedNo, "03-search-closed");
  if (phone) results.phone = await probe(phone, "04-search-phone");

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify({ fixture, results }, null, 2));
  writeFileSync(`${OUT}/RUN-LOG.txt`, log.join("\n") + "\n");
  say("evidence ->", OUT);

  await ctx.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
