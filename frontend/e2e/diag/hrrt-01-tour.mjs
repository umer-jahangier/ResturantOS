import { P, OUT, login, newPage, shot, visit } from "./hrrt-lib.mjs";

const ROUTES = [
  "/app/hr",
  "/app/hr/employees",
  "/app/hr/payroll",
  "/app/hr/schedule",
  "/app/hr/attendance",
  "/app/hr/settings",
  "/app/hr/settings/tax",
  "/app/hr/settings/departments",
  "/app/hr/settings/designations",
];

const who = process.argv[2] ?? "owner";

const { browser, page } = await newPage();
try {
  await login(page, P[who]);

  // Does the sidebar even offer HR?
  await page.goto("http://localhost:3000/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const navLinks = await page.locator("nav a, aside a").allInnerTexts().catch(() => []);
  const hrHref = await page.locator('a[href^="/app/hr"]').count();
  console.log(`\n### ${who}: sidebar a[href^="/app/hr"] count = ${hrHref}`);
  console.log("### nav labels:", JSON.stringify(navLinks.map((s) => s.trim()).filter(Boolean)));
  await shot(page, `${who}-00-dashboard-nav`);

  for (const r of ROUTES) {
    const s = await visit(page, r, { persona: P[who] });
    const tag = s.denied ? "ACCESS-DENIED" : s.notfound ? "404" : s.broken ? "ERROR" : "ok";
    console.log(`\n=== ${who} ${r} [${tag}] url=${s.url}`);
    console.log(s.body.replace(/\n{2,}/g, "\n").slice(0, 1400));
    await shot(page, `${who}-${r.replace(/\//g, "_")}`);
  }
} finally {
  await browser.close();
}
