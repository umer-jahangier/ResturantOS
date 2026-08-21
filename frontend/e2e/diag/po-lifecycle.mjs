// ATTACK 3: the whole PO lifecycle on a phone. Reject dialog gets forensic treatment because
// its confirm button stayed disabled after a reason was typed.
import { chromium, newCtx, login, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";

async function open(page, id) {
  await page.goto(`${BASE}/app/purchasing/purchase-orders/${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await assertSession(page, id);
}
const head = (page) => page.evaluate(() => document.body.innerText.split("Analytics")[1]?.slice(0, 260).replace(/\n+/g, " | "));
const btns = (page) => page.evaluate(() => [...document.querySelectorAll("button")]
  .map((b) => `${b.innerText.trim()}${b.disabled ? "[DISABLED]" : ""}`)
  .filter((t) => t && !/Collapse|Search|Floating|^F$/.test(t)));

async function dialogState(page) {
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"],[role="alertdialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      text: d.innerText.slice(0, 200).replace(/\n+/g, " | "),
      fields: [...d.querySelectorAll("input,textarea,select")].map((i) => ({
        tag: i.tagName, type: i.type, name: i.name, id: i.id,
        placeholder: i.placeholder, value: i.value, required: i.required, maxLength: i.maxLength,
      })),
      buttons: [...d.querySelectorAll("button")].map((b) => `${b.innerText.trim()}${b.disabled ? "[DISABLED]" : ""}`),
    };
  });
}

async function run(label, fn) {
  try { await fn(); } catch (e) { console.log(`  !! ${label} threw: ${String(e).split("\n")[0].slice(0, 160)}`); }
}

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 390, height: 844 });
  const api = [];
  page.on("response", (r) => { if (/\/purchasing\//.test(r.url())) api.push(`${r.request().method()} ${r.status()} ${r.url().split("/api/v1")[1]}`); });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  // ── 1. REJECT: forensic. Type into the reason field the way a human does. ──
  const rejectPo = "bb49abfb-ab0d-4a35-bc52-2e15d44a1740";
  console.log("\n=== REJECT FORENSICS on", rejectPo.slice(0, 8), "===");
  await open(page, rejectPo);
  console.log("  before:", await head(page));
  await page.locator('button:has-text("Reject")').first().click();
  await page.waitForTimeout(1500);
  console.log("  dialog opened:", JSON.stringify(await dialogState(page)));
  const field = page.locator('[role="dialog"] input, [role="dialog"] textarea, [role="alertdialog"] input, [role="alertdialog"] textarea').first();
  await run("focus+type", async () => {
    await field.click();
    await page.keyboard.type("Damaged on arrival, wrong grade of rice", { delay: 25 });
  });
  await page.waitForTimeout(1200);
  console.log("  after typing:", JSON.stringify(await dialogState(page)));
  await shot(page, "po-reject-dialog-after-typing");
  const confirm = page.locator('[role="dialog"] button, [role="alertdialog"] button').filter({ hasText: /^Reject$/ }).first();
  if ((await confirm.count()) && !(await confirm.isDisabled())) {
    await confirm.click(); await page.waitForTimeout(3500);
    console.log("  CLICKED confirm. api:", JSON.stringify(api.slice(-3)));
    await open(page, rejectPo);
    console.log("  after reload:", await head(page));
  } else {
    console.log("  >>> CONFIRM STILL DISABLED after typing a reason — reject cannot be completed");
    await shot(page, "po-reject-BLOCKED");
  }

  // ── 2. The rest of the chain on the PO just approved ──
  const approved = "99a80052-e7fb-41da-b958-fbb437fbb3f2";
  console.log("\n=== SEND TO VENDOR on", approved.slice(0, 8), "===");
  await open(page, approved);
  console.log("  before:", await head(page), "\n  buttons:", JSON.stringify(await btns(page)));
  await run("send", async () => {
    api.length = 0;
    await page.locator('button:has-text("Send to vendor")').first().click();
    await page.waitForTimeout(2000);
    const d = await dialogState(page);
    if (d) { console.log("  dialog:", JSON.stringify(d));
      const c = page.locator('[role="dialog"] button,[role="alertdialog"] button').filter({ hasText: /Send|Confirm/i }).first();
      if ((await c.count()) && !(await c.isDisabled())) { await c.click(); await page.waitForTimeout(3000); } }
    await page.waitForTimeout(2000);
    console.log("  api:", JSON.stringify(api));
    await open(page, approved);
    console.log("  after reload:", await head(page), "\n  buttons:", JSON.stringify(await btns(page)));
    await shot(page, "po-after-send");
  });

  // ── 3. DRAFT: can a buyer submit a draft for approval at all? ──
  const draft = "d43693ce-fab3-4273-9781-36e8f4557b10";
  console.log("\n=== DRAFT", draft.slice(0, 8), "===");
  await open(page, draft);
  console.log("  head:", await head(page), "\n  buttons:", JSON.stringify(await btns(page)));
  await shot(page, "po-draft");

  // ── 4. WITHDRAW on another pending PO ──
  console.log("\n=== WITHDRAW ===");
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/proxy-nope").catch(() => null); return !!r;
  });
  const pending = "5c6b0bb2-0000-0000-0000-000000000000"; // replaced below if found
  void pending; void res;

  // ── 5. CLOSE a fully-received PO ──
  const fully = "ca6ed037-da8d-467f-acad-c34cfb302515";
  console.log("\n=== CLOSE PO on", fully.slice(0, 8), "===");
  await open(page, fully);
  console.log("  before:", await head(page), "\n  buttons:", JSON.stringify(await btns(page)));
  await run("close", async () => {
    api.length = 0;
    await page.locator('button:has-text("Close PO")').first().click();
    await page.waitForTimeout(2000);
    const d = await dialogState(page);
    if (d) {
      console.log("  dialog:", JSON.stringify(d));
      const f = page.locator('[role="dialog"] input, [role="dialog"] textarea').first();
      if (await f.count()) { await f.click(); await page.keyboard.type("Received and reconciled", { delay: 20 }); await page.waitForTimeout(800); }
      console.log("  dialog after typing:", JSON.stringify(await dialogState(page)));
      const c = page.locator('[role="dialog"] button').filter({ hasText: /^Close|Confirm/i }).first();
      if ((await c.count()) && !(await c.isDisabled())) { await c.click(); await page.waitForTimeout(3500); }
      else console.log("  >>> close confirm DISABLED");
    }
    console.log("  api:", JSON.stringify(api));
    await open(page, fully);
    console.log("  after reload:", await head(page));
    await shot(page, "po-after-close");
  });

  await browser.close();
}
main();
