import { P, login, newPage, shot, visit } from "./hrrt-lib.mjs";

const { browser, page } = await newPage();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/v1\/hr\//.test(u)) return;
  let t = "";
  if (r.status() >= 400 || /summary|punches/.test(u)) { try { t = (await r.text()).slice(0, 250); } catch {} }
  if (r.request().method() !== "GET" || r.status() >= 400 || /summary|punches/.test(u))
    net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}${t ? " :: " + t : ""}`);
});
const toasts = async () =>
  (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).map((s) => s.replace(/\n/g, " | "));

try {
  await login(page, P.owner);

  // ---- 1. NEW PAYROLL RUN (never independently driven) ----
  await visit(page, "/app/hr/payroll", { persona: P.owner });
  const numIns = page.locator("main input[type=number]");
  console.log("[newrun] month/year defaults:", await numIns.nth(0).inputValue(), await numIns.nth(1).inputValue());
  await numIns.nth(0).fill("6");
  await numIns.nth(1).fill("2026");
  await page.getByRole("button", { name: /^New run$/i }).click();
  await page.waitForTimeout(4000);
  console.log("[newrun] toasts:", JSON.stringify(await toasts()));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  console.log("[newrun] runs listed:", JSON.stringify((await page.locator("main .rounded.border > div > button").allInnerTexts())));
  await shot(page, "fin-01-new-run");

  // Duplicate guard: create 6/2026 again.
  await page.locator("main input[type=number]").nth(0).fill("6");
  await page.locator("main input[type=number]").nth(1).fill("2026");
  await page.getByRole("button", { name: /^New run$/i }).click();
  await page.waitForTimeout(3500);
  console.log("[newrun] toasts on DUPLICATE period:", JSON.stringify(await toasts()));

  // A run for a period years in the future — is anything sane refused?
  await page.locator("main input[type=number]").nth(0).fill("13");
  await page.locator("main input[type=number]").nth(1).fill("2099");
  await page.getByRole("button", { name: /^New run$/i }).click();
  await page.waitForTimeout(3500);
  console.log("[newrun] toasts on month=13 year=2099:", JSON.stringify(await toasts()));
  await shot(page, "fin-02-bad-period");

  // ---- 2. ATTENDANCE SUMMARY vs a real shift assignment ----
  await visit(page, "/app/hr/attendance", { persona: P.owner });
  const sec = page.locator("main section").nth(0);
  await sec.locator("select").selectOption({ index: 1 }); // TESt — assigned 09:00-17:00 on 08-11
  await page.waitForTimeout(3500);
  console.log("[att] summary for an employee rostered 09:00–17:00 who punched IN at 22:54 UTC:");
  console.log("      ", (await sec.innerText()).split("\n").pop());
  await shot(page, "fin-03-attendance-summary");

  // Does ANY screen show the punch times we recorded?
  const body = await page.locator("main").innerText();
  console.log("[att] page shows any punch time (22:5 / 03:5)?", /22:5|03:5|Clock-in at|punch/i.test(body) ? "yes" : "NO");

  // ---- 3. Any HR reporting? ----
  for (const r of ["/app/reports"]) {
    await visit(page, r, { persona: P.owner, waitMs: 5000 });
    const t = await page.locator("main").innerText().catch(() => "");
    console.log(`\n[reports] ${r} mentions HR/labour/payroll/staff?`,
      JSON.stringify(t.split("\n").filter((l) => /hr|labour|labor|payroll|staff|employee|attendance|headcount/i.test(l)).slice(0, 12)));
    await shot(page, "fin-04-reports");
  }
} catch (e) {
  console.log("FATAL", String(e).slice(0, 500));
  await shot(page, "fin-FATAL");
} finally {
  console.log("\n[network]");
  for (const l of net) console.log("   " + l);
  await browser.close();
}
