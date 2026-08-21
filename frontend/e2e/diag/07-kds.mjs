// (e) does the fired ticket appear on the correct station's KDS board, live?
// (f) does a station-scoped account see only its own station's tickets?
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot, BASE } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on("response", (res) => {
  const u = res.url();
  if (/kitchen|ticket/i.test(u)) console.log(`  NET ${res.request().method()} ${res.status()} ${u.replace("http://localhost:8080", "").slice(0, 120)}`);
});

try {
  console.log("== sign in as KITCHEN staff ==");
  console.log(" ", await login(page, { email: "kitchen@terrace.local", password: "Terrace#Kitchen1" }));

  const r = await openAndCheck(page, "/app/kitchen", { settle: 3500 });
  console.log("  url:", r.url, "| h1:", r.h1, "| denied:", r.denied, "| failed:", r.failed);
  console.log("  alerts:", JSON.stringify(r.alerts).slice(0, 200));
  console.log("  STATION PICKER text:", r.body.replace(/\n+/g, " | ").slice(0, 500));
  await shot(page, "e1-kds-station-picker");

  // enumerate the station choices offered to this account
  const links = await page.getByRole("link").evaluateAll((els) =>
    els.map((e) => ({ t: (e.textContent || "").trim().slice(0, 40), href: e.getAttribute("href") })));
  console.log("  links:", JSON.stringify(links.filter((l) => /kitchen/.test(l.href || ""))));
  const btns = await page.getByRole("button").evaluateAll((els) => els.map((e) => (e.textContent || "").trim().slice(0, 40)).filter(Boolean));
  console.log("  buttons:", JSON.stringify(btns));

  // visit each station board and record which tickets/items it shows
  for (const code of ["GRILL", "BAR", "DEFAULT", "DGB28334"]) {
    const res = await openAndCheck(page, `/app/kitchen/${code}`, { settle: 3500 });
    const text = res.body.replace(/\n+/g, " | ");
    console.log(`\n  === /app/kitchen/${code} ===`);
    console.log(`    h1="${res.h1}" denied=${res.denied} failed=${res.failed}`);
    console.log(`    alerts: ${JSON.stringify(res.alerts).slice(0, 150)}`);
    console.log(`    ticket cards: ${await page.getByTestId("kds-ticket-card").count().catch(() => -1)}`);
    console.log(`    mentions Chicken Karahi: ${/Chicken Karahi/.test(text)} | mentions Fresh Lime: ${/Fresh Lime/.test(text)}`);
    console.log(`    body: ${text.slice(0, 600)}`);
    await shot(page, `e2-kds-${code}`);
  }
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-kds-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
