/* Pass 4: follow the product's OWN remedy — "Sign in again" — and see if approve then works. */
import { newBrowser, ctxPage, login, visit, shot, PERSONAS, totpNow, BASE } from "./hr-lib.mjs";

const browser = await newBrowser();
const { page } = await ctxPage(browser);
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/hr/payroll-runs") && r.request().method() === "POST") {
    let b = ""; try { b = (await r.text()).slice(0, 300); } catch {}
    console.log(`    NET POST ${u.split("/api")[1]} -> ${r.status()} ${b}`);
  }
});

await login(page, PERSONAS.owner);

async function dumpClaims(tag) {
  const claims = await page.evaluate(() => {
    const out = {};
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k) || "";
      const m = v.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./);
      if (m) {
        try { out[k] = JSON.parse(atob(m[0].split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch {}
      }
    }
    return out;
  });
  for (const [k, v] of Object.entries(claims)) {
    console.log(`  [${tag}] ${k}: totp_verified=${v.totp_verified} exp=${v.exp} iat=${v.iat} amr=${JSON.stringify(v.amr)}`);
  }
  const cookieClaims = await page.context().cookies();
  for (const c of cookieClaims) {
    if (/eyJ/.test(c.value)) {
      try {
        const p = JSON.parse(Buffer.from(c.value.split(".")[1], "base64").toString());
        console.log(`  [${tag}] cookie ${c.name}: totp_verified=${p.totp_verified} iat=${p.iat} exp=${p.exp} age=${Math.round(Date.now()/1000 - p.iat)}s`);
      } catch {}
    }
  }
}

await dumpClaims("just-logged-in");

await visit(page, "/app/hr/payroll");
let approve = page.getByRole("button", { name: /^Approve$/ });
console.log("approve buttons:", await approve.count());
await approve.first().click();
await page.waitForTimeout(4000);
const notice = await page.locator('[role="alert"]').allInnerTexts();
console.log("notice:", notice.filter(Boolean).join(" | "));

// The product's own remedy.
const again = page.getByRole("button", { name: /Sign in again/i });
console.log("has 'Sign in again':", await again.count());
if (await again.count()) {
  await again.first().click();
  await page.waitForTimeout(3000);
  console.log("landed on:", page.url());
  await shot(page, "04-stepup-login");
  const body = await page.locator("body").innerText();
  console.log("login screen text:\n", body.split("\n").filter(Boolean).slice(0, 20).join("\n"));

  // complete the login again
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(PERSONAS.owner.slug);
  const emailF = page.locator('input[name="email"], input#email');
  if (await emailF.count()) {
    await emailF.first().fill(PERSONAS.owner.email);
    await page.locator('input[name="password"], input#password').first().fill(PERSONAS.owner.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3500);
  }
  const totpField = page.locator('input[name="totpCode"], input#totpCode');
  console.log("TOTP field present:", await totpField.count());
  if (await totpField.count()) {
    await totpField.first().fill(totpNow(PERSONAS.owner.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  console.log("after re-login, url:", page.url());
  await shot(page, "04-after-relogin");
}

await dumpClaims("after-relogin");

if (!page.url().includes("/app/hr/payroll")) {
  console.log("!! did NOT return to payroll; navigating manually");
  await visit(page, "/app/hr/payroll");
}
approve = page.getByRole("button", { name: /^Approve$/ });
console.log("approve buttons after re-login:", await approve.count());
if (await approve.count()) {
  await approve.first().click();
  await page.waitForTimeout(5000);
}
const after = await page.locator("body").innerText();
console.log("run statuses:", after.match(/(DRAFT|CALCULATED|APPROVED|PAID)/g)?.join(",") ?? "?");
console.log("alerts:", (await page.locator('[role="alert"]').allInnerTexts()).filter(Boolean).join(" | "));
await shot(page, "04-after-approve-retry");

const pay = page.getByRole("button", { name: /Mark paid/i });
console.log("Mark paid buttons:", await pay.count());
if (await pay.count()) {
  await pay.first().click();
  await page.waitForTimeout(6000);
  console.log("after pay statuses:", (await page.locator("body").innerText()).match(/(DRAFT|CALCULATED|APPROVED|PAID)/g)?.join(",") ?? "?");
}
await shot(page, "04-after-pay");
await browser.close();
