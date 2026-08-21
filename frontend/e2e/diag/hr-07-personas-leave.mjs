/* Pass 7: unpaid-leave approval dead end, and who can reach HR at all. */
import { newBrowser, ctxPage, login, visit, shot, PERSONAS } from "./hr-lib.mjs";

const browser = await newBrowser();

// ---- A. unpaid leave: request then try to approve from the screen ----
{
  const { ctx, page } = await ctxPage(browser);
  let lastId = null;
  page.on("response", async (r) => {
    if (r.url().includes("/hr/leave/requests") && r.request().method() === "POST") {
      let b = ""; try { b = await r.text(); } catch {}
      console.log(`    NET POST leave -> ${r.status()} ${b.slice(0, 200)}`);
      const m = b.match(/"id":"([0-9a-f-]{36})"/);
      if (m) lastId = m[1];
    }
  });
  await login(page, PERSONAS.owner);
  await visit(page, "/app/hr/attendance", { persona: PERSONAS.owner });
  const leaveSection = page.locator("section").filter({ hasText: "Leave type…" });
  await leaveSection.locator("select").nth(0).selectOption({ index: 1 });
  const types = await leaveSection.locator("select").nth(1).locator("option").allInnerTexts();
  console.log("leave types:", JSON.stringify(types));
  const unpaidIdx = types.findIndex((t) => /unpaid/i.test(t));
  console.log("unpaid index:", unpaidIdx);
  await leaveSection.locator("select").nth(1).selectOption({ index: unpaidIdx });
  await page.getByRole("button", { name: /Request leave/i }).click();
  await page.waitForTimeout(3500);
  const bodyTxt = await page.locator("body").innerText();
  console.log("toast text:", bodyTxt.match(/Leave requested[^\n]*|Request failed[^\n]*/)?.[0] ?? "(none)");
  console.log("full id from network:", lastId);
  await shot(page, "07-unpaid-leave-requested");

  // The screen only ever shows 8 chars. Try approving with what the screen gave the user.
  const shown = bodyTxt.match(/Leave requested \(([0-9a-f]+)\)/)?.[1];
  console.log("id the SCREEN showed the user:", shown, `(${shown?.length ?? 0} chars of 36)`);
  if (shown) {
    await page.getByPlaceholder(/Leave request id/i).fill(shown);
    await page.getByRole("button", { name: /^Approve$/ }).click();
    await page.waitForTimeout(3000);
    console.log("approve-with-screen-id result:", (await page.locator("body").innerText()).match(/Approved|Failed/)?.[0]);
  }
  // Now with the real id, which no screen shows.
  if (lastId) {
    await page.getByPlaceholder(/Leave request id/i).fill(lastId);
    await page.getByRole("button", { name: /^Approve$/ }).click();
    await page.waitForTimeout(3000);
    console.log("approve-with-real-id result:", (await page.locator("body").innerText()).match(/Approved|Failed/)?.[0]);
  }
  await shot(page, "07-leave-approve");
  await ctx.close();
}

// ---- B. personas ----
for (const key of ["manager", "accountant"]) {
  const { ctx, page } = await ctxPage(browser);
  try {
    await login(page, PERSONAS[key]);
    console.log(`\n########## ${key.toUpperCase()} ##########  landed ${page.url()}`);
    const nav = await page.locator("nav, aside").first().innerText().catch(() => "");
    console.log("sidebar has HR:", /\bHR\b/.test(nav));
    for (const route of ["/app/hr/employees", "/app/hr/payroll", "/app/hr/attendance", "/app/hr/settings/tax"]) {
      const r = await visit(page, route, { persona: PERSONAS[key] });
      const head = r.body.split("\n").filter(Boolean).slice(-8).join(" / ");
      console.log(`  ${route} -> denied=${r.denied} :: ${head.slice(0, 220)}`);
      await shot(page, `07-${key}-${route.replace(/\//g, "_")}`);
    }
  } catch (e) {
    console.log(`  ${key} FAILED: ${String(e).slice(0, 300)}`);
  }
  await ctx.close();
}

await browser.close();
