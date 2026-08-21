import { P, login, newPage, shot, visit } from "./hrrt-lib.mjs";

const { browser, page } = await newPage();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/v1\/(hr|auth)\//.test(u)) return;
  let t = "";
  if (r.status() >= 400 || /approve|calculate|pay|labour/.test(u)) {
    try { t = (await r.text()).slice(0, 300); } catch {}
  }
  net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}${t ? " :: " + t : ""}`);
});
const toasts = async () =>
  (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).map((s) => s.replace(/\n/g, " | "));

function jwtClaims(tok) {
  try { return JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()); } catch { return null; }
}

try {
  const t0 = Date.now();
  await login(page, P.owner);
  console.log(`[timing] login done at t+${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // How long is the access token's life, and does it carry totp_verified right after login?
  const tok = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      const v = localStorage.getItem(k) ?? "";
      const m = v.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      if (m) return m[0];
    }
    return null;
  });
  if (tok) {
    const c = jwtClaims(tok);
    console.log("[jwt] totp_verified =", c?.totp_verified, "| exp-iat =", c?.exp - c?.iat, "s | roles:", c?.roles ?? c?.authorities?.slice?.(0, 3));
  } else {
    console.log("[jwt] no token found in localStorage (httpOnly cookie?)");
  }

  // Go straight to payroll and act FAST — the claim under test is that the first approval of a
  // session always 403s. If it 403s within seconds of signing in, the cause is not "an hour".
  await visit(page, "/app/hr/payroll", { persona: P.owner, waitMs: 3000 });
  console.log(`[timing] payroll page at t+${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await shot(page, "pay-00-list");

  const rowFor = (label) => page.locator("main .rounded.border", { hasText: label }).first();
  const draft = rowFor("7/2026");
  console.log("[rows]", JSON.stringify(await page.locator("main .rounded.border > div > button").allInnerTexts()));

  // ---- CALCULATE ----
  await draft.getByRole("button", { name: "Calculate" }).click();
  await page.waitForTimeout(4000);
  console.log("[calc] toasts:", JSON.stringify(await toasts()));
  console.log("[calc] row now:", (await draft.innerText()).replace(/\n/g, " | ").slice(0, 200));
  await shot(page, "pay-01-calculated");

  // ---- APPROVE (first attempt of the session) ----
  const approveBtn = draft.getByRole("button", { name: "Approve", exact: true });
  if (await approveBtn.count()) {
    console.log(`[timing] clicking Approve at t+${((Date.now() - t0) / 1000).toFixed(1)}s after login`);
    await approveBtn.click();
    await page.waitForTimeout(4000);
    console.log("[approve#1] toasts:", JSON.stringify(await toasts()));
    const notice = await page.locator("main").innerText();
    console.log("[approve#1] step-up notice present?", /[Vv]erification/.test(notice));
    if (/[Vv]erification/.test(notice)) {
      const idx = notice.search(/[Vv]erification/);
      console.log("[approve#1] notice text:", notice.slice(idx, idx + 320).replace(/\n/g, " | "));
    }
    await shot(page, "pay-02-approve-attempt1");
  } else {
    console.log("[approve] NO Approve button rendered after calculate");
    console.log("[approve] visible buttons:", JSON.stringify(await draft.locator("button").allInnerTexts()));
  }

  // ---- expand the run: payslips + labour cost ----
  await draft.locator("button").first().click();
  await page.waitForTimeout(4000);
  console.log("\n[expanded]\n" + (await draft.innerText()));
  await shot(page, "pay-03-payslips");
} catch (e) {
  console.log("FATAL", String(e).slice(0, 500));
  await shot(page, "pay-FATAL");
} finally {
  console.log("\n[network]");
  for (const l of net) console.log("   " + l);
  await browser.close();
}
