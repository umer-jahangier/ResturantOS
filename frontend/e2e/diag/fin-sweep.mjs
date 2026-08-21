/* Sweep every finance route as a given persona, recording text, alerts, XHR failures. */
import { chromium } from "@playwright/test";
import { BASE, OUT, PERSONAS, login, shot, save, visit } from "./fin-lib.mjs";

const WHO = process.argv[2] ?? "accountant";
const ROUTES = [
  "/app/finance",
  "/app/finance/takings",
  "/app/finance/transactions",
  "/app/finance/accounts",
  "/app/finance/journal-entries",
  "/app/finance/journal-entries/new",
  "/app/finance/gl",
  "/app/finance/periods",
  "/app/finance/expenses",
  "/app/finance/ap-aging",
  "/app/finance/house-accounts",
  "/app/finance/ar-aging",
  "/app/finance/guide",
  "/app/pos/tills",
  "/app/reports",
];

const p = PERSONAS[WHO];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();

const net = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/") && r.status() >= 400) net.push(`${r.status()} ${r.request().method()} ${u}`);
});
const consoleErrs = [];
page.on("pageerror", (e) => consoleErrs.push(String(e).slice(0, 200)));

if (!(await login(page, p))) {
  console.log(`LOGIN FAILED for ${p.email} — url ${page.url()}`);
  await shot(page, `LOGINFAIL-${WHO}`);
  process.exit(1);
}
console.log(`signed in as ${p.email}`);
const perms = await page.evaluate(() => {
  try {
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k);
      if (v && v.includes("permission")) return `${k} => ${v.slice(0, 4000)}`;
    }
  } catch {}
  return "n/a";
});
save(`perms-${WHO}.txt`, perms);

const report = [];
for (const route of ROUTES) {
  net.length = 0;
  const r = await visit(page, route);
  const f = await shot(page, `${WHO}${route.replace(/\//g, "_")}`);
  const flag = r.denied ? "DENIED" : r.errored ? "ERROR" : "ok";
  console.log(`[${flag}] ${route} (attempt ${r.attempt}) -> ${r.url}`);
  if (net.length) console.log("   api-fail:", net.join(" | "));
  report.push(
    `\n\n========== ${route} [${flag}] attempt=${r.attempt} finalUrl=${r.url}\n` +
      `--- api failures: ${net.join(" | ") || "none"}\n` +
      `--- alerts: ${JSON.stringify(r.alerts)}\n` +
      `--- shot: ${f}\n` +
      r.body.slice(0, 6000),
  );
}
save(`sweep-${WHO}.txt`, report.join("\n"));
save(`pageerrors-${WHO}.txt`, consoleErrs.join("\n"));
console.log("written ->", `${OUT}/sweep-${WHO}.txt`);
await browser.close();
