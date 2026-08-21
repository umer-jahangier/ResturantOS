/* S1 re-open, step 2: make MY OWN routing decisions through the controls, count the writes,
 * read the toast, reload, and confirm the wire agrees with the screen. */
import {
  newBrowser, newPage, login, PEOPLE, go, shot, log, saveState, writeJson, apiGet,
} from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
const findings = [];

function branchIdFrom(page) {
  const hit = page.__requests.find((r) => /menu\/routing\?branchId=/.test(r.u));
  return hit ? new URL(hit.u).searchParams.get("branchId") : null;
}

async function readBoard(page) {
  return page.evaluate(() => ({
    summary: document.querySelector('[data-testid="routing-summary"]')?.textContent?.trim() ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
    cats: Array.from(document.querySelectorAll('[data-testid="routing-category"]')).map((n) => ({
      name: n.getAttribute("data-category-name"),
      value: n.querySelector('[data-testid="category-station-select"]')?.value ?? null,
      text: n.querySelector('[data-testid="category-station-select"]')?.selectedOptions?.[0]?.text ?? null,
      disabled: n.querySelector('[data-testid="category-station-select"]')?.disabled ?? null,
    })),
    rows: Array.from(document.querySelectorAll('[data-testid="routing-item"]')).map((n) => ({
      name: n.getAttribute("data-item-name"),
      eff: n.getAttribute("data-effective-station"),
      src: n.getAttribute("data-route-source"),
      destText: n.querySelector('[data-testid="routing-item-destination"]')?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      value: n.querySelector('[data-testid="item-station-select"]')?.value ?? null,
      optText: n.querySelector('[data-testid="item-station-select"]')?.selectedOptions?.[0]?.text ?? null,
    })),
  }));
}

/** Pick a select by testid within a card/row identified by a data attribute, set it, count PUTs. */
async function setSelect(page, selector, value, label) {
  const before = page.__requests.length;
  const el = page.locator(selector).first();
  await el.selectOption(value);
  await page.waitForTimeout(3500);
  const fired = page.__requests.slice(before).filter((r) => r.m === "PUT");
  const toasts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast], li[data-sonner-toast], ol[data-sonner-toaster] li"))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean),
  );
  log(`  ${label}: PUTs=${fired.length} ${JSON.stringify(fired.map((f) => f.s + " " + f.u.replace("http://localhost:8080", "")))}`);
  log(`    toasts: ${JSON.stringify(toasts)}`);
  return { fired, toasts };
}

try {
  await login(page, PEOPLE.owner);
  await go(page, "/app/menu/routing", { waitMs: 4500 });
  const branchId = branchIdFrom(page);
  log(`  branchId (from the app's own request) = ${branchId}`);
  saveState({ branchId });

  const stationsRes = await apiGet(page, `/api/v1/pos/stations?branchId=${branchId}`);
  const raw = stationsRes.body?.data ?? stationsRes.body;
  const stations = (Array.isArray(raw) ? raw : (raw?.content ?? [])).map((s) => ({
    id: s.id, code: s.code, name: s.name, active: s.active, type: s.type ?? s.stationType,
  }));
  log(`  stations api=${stationsRes.status} n=${stations.length}: ${stations.map((s) => `${s.code}${s.active === false ? "[INACTIVE]" : ""}`).join(", ")}`);

  const before = await readBoard(page);
  writeJson("02-before.json", { before, stations, branchId });
  await shot(page, "02a-before");

  // ---- What the select actually offers (does it offer an INACTIVE station?) ----
  const offered = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-testid="category-station-select"]')[0]?.options ?? [],
    ).map((o) => ({ value: o.value, text: o.text })),
  );
  log(`  category select offers ${offered.length} options: ${JSON.stringify(offered.map((o) => o.text))}`);
  const inactiveOffered = stations
    .filter((s) => s.active === false)
    .filter((s) => offered.some((o) => o.value === s.id));
  if (inactiveOffered.length) {
    findings.push({
      k: "inactive-station-offered",
      detail: `select offers deactivated stations: ${inactiveOffered.map((s) => s.code).join(",")}`,
    });
  }

  // ---- MY OWN decision A: route the "Mains" category (untouched by the claimant) ----
  const grill = stations.find((s) => s.code === "GRILL");
  const bar = stations.find((s) => s.code === "BAR");
  const pantry = stations.find((s) => s.code === "PANTRY1");
  if (!grill || !bar) throw new Error("expected BAR and GRILL stations");

  const mainsCat = before.cats.find((c) => c.name === "Mains");
  log(`  Mains currently: ${JSON.stringify(mainsCat)}`);
  const a = await setSelect(
    page,
    '[data-testid="routing-category"][data-category-name="Mains"] [data-testid="category-station-select"]',
    grill.id,
    "Mains -> GRILL",
  );

  const afterA = await readBoard(page);
  const karahi = afterA.rows.find((r) => r.name === "Chicken Karahi");
  log(`  Chicken Karahi now: ${JSON.stringify(karahi)}`);
  await shot(page, "02b-mains-to-grill");

  // ---- MY OWN decision B: one dish exception — a Mains dish onto the BAR ----
  const b = await setSelect(
    page,
    '[data-testid="routing-item"][data-item-name="Mutton Biryani"] [data-testid="item-station-select"]',
    bar.id,
    "Mutton Biryani -> BAR (per-item exception)",
  );
  const afterB = await readBoard(page);
  log(`  Mutton Biryani now: ${JSON.stringify(afterB.rows.find((r) => r.name === "Mutton Biryani"))}`);
  await shot(page, "02c-biryani-to-bar");

  // ---- Reload: does it PERSIST? ----
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const afterReload = await readBoard(page);
  const persisted = {
    mains: afterReload.cats.find((c) => c.name === "Mains"),
    karahi: afterReload.rows.find((r) => r.name === "Chicken Karahi"),
    biryani: afterReload.rows.find((r) => r.name === "Mutton Biryani"),
  };
  log(`  after reload: ${JSON.stringify(persisted)}`);
  await shot(page, "02d-after-reload");

  // ---- And the wire, independently ----
  const wire = await apiGet(page, `/api/v1/pos/menu/routing?branchId=${branchId}`);
  const wr = wire.body?.data ?? wire.body;
  const wireBiryani = (wr?.items ?? []).find((i) => i.itemName === "Mutton Biryani");
  const wireKarahi = (wr?.items ?? []).find((i) => i.itemName === "Chicken Karahi");
  log(`  wire Mutton Biryani: ${JSON.stringify(wireBiryani)}`);
  log(`  wire Chicken Karahi: ${JSON.stringify(wireKarahi)}`);

  writeJson("02-after.json", {
    a: { puts: a.fired, toasts: a.toasts },
    b: { puts: b.fired, toasts: b.toasts },
    afterA: afterA.rows.filter((r) => ["Chicken Karahi", "Mutton Biryani"].includes(r.name)),
    afterB: afterB.rows.filter((r) => ["Chicken Karahi", "Mutton Biryani"].includes(r.name)),
    persisted, wireBiryani, wireKarahi, offered, findings,
    consoleErrors: page.__console,
  });
  saveState({ stations, mainsRoutedTo: "GRILL", biryaniRoutedTo: "BAR" });
  log(`  findings: ${JSON.stringify(findings)}`);
  log(`  console errors: ${JSON.stringify(page.__console.slice(0, 5))}`);
} finally {
  await browser.close();
}
