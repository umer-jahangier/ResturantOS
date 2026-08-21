// ATTACK 2: the other agent saw Approve/Reject/Withdraw BUTTONS. Buttons are not a workflow.
// Drive the whole chain on a phone viewport (where the card link is real) and RELOAD to prove
// persistence. Nothing here is a verdict unless the status survived a reload.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";

async function statusOf(page) {
  return page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/PO [0-9a-f]{8}…\s*\n?\s*([A-Za-z ]+)\s*\n/);
    return { badge: m ? m[1].trim() : null, head: t.slice(0, 400).replace(/\n+/g, " | ") };
  });
}
async function buttons(page) {
  return page.evaluate(() => [...document.querySelectorAll("button")]
    .map((b) => ({ t: b.innerText.trim(), disabled: b.disabled }))
    .filter((b) => b.t && !/Collapse|Search|Floating Terrace|^F$/.test(b.t)));
}

async function openPo(page, id) {
  await page.goto(`${BASE}/app/purchasing/purchase-orders/${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  await assertSession(page, `po ${id}`);
}

/** Clicks a labelled action, waits, and reports what the API said and what the page says after. */
async function act(page, id, label) {
  const responses = [];
  const onResp = (r) => {
    if (/purchas/.test(r.url())) responses.push(`${r.request().method()} ${r.status()} ${r.url().replace("http://localhost:8080", "")}`);
  };
  page.on("response", onResp);
  const btn = page.locator(`button:has-text("${label}")`).first();
  if (!(await btn.count())) { page.off("response", onResp); return { clicked: false, reason: "button absent" }; }
  const wasDisabled = await btn.isDisabled();
  if (wasDisabled) { page.off("response", onResp); return { clicked: false, reason: "button disabled" }; }
  await btn.click();
  await page.waitForTimeout(2500);

  // Some actions open a confirm dialog. Measure the dialog too — every dialog here was 24px wide.
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), text: d.innerText.slice(0, 300).replace(/\n+/g, " | "),
      buttons: [...d.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean),
      inputs: [...d.querySelectorAll("input,textarea,select")].map((i) => i.name || i.id || i.type) };
  });
  if (dlg) {
    console.log(`    dialog ${dlg.w}x${dlg.h}px :: ${dlg.text}`);
    console.log(`    dialog buttons: ${JSON.stringify(dlg.buttons)} inputs: ${JSON.stringify(dlg.inputs)}`);
    // fill any required reason then confirm
    const ta = page.locator('[role="dialog"] textarea, [role="alertdialog"] textarea, [role="dialog"] input[type="text"]').first();
    if (await ta.count()) await ta.fill("Red-team diagnostic — audit probe");
    const confirm = page.locator('[role="dialog"] button, [role="alertdialog"] button')
      .filter({ hasText: new RegExp(`^(${label}|Confirm|Yes|Submit|Save|OK)`, "i") }).first();
    if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(3000); }
    else console.log("    !! no confirm button matched — dialog may be a dead end");
  }
  await page.waitForTimeout(2500);
  page.off("response", onResp);

  const alert = await page.evaluate(() => [...document.querySelectorAll('[role="alert"],[data-sonner-toast],.toast')]
    .map((e) => e.innerText.trim()).join(" ~ ").slice(0, 300));
  const after = await statusOf(page);
  // reload — the only thing that proves it persisted
  await openPo(page, id);
  const reloaded = await statusOf(page);
  return { clicked: true, responses, alert, hadDialog: !!dlg, after: after.badge, reloaded: reloaded.badge, reloadHead: reloaded.head };
}

const TARGETS = [
  { id: "99a80052-e7fb-41da-b958-fbb437fbb3f2", status: "PENDING_APPROVAL", try: ["Approve"] },
  { id: "bb49abfb-ab0d-4a35-bc52-2e15d44a1740", status: "PENDING_APPROVAL", try: ["Reject"] },
  { id: "d43693ce-fab3-4273-9781-36e8f4557b10", status: "DRAFT", try: [] },
  { id: "dcdd1101-b527-4775-9729-4c5d08988aad", status: "APPROVED", try: [] },
  { id: "0ed3f5e4-b362-49fb-a6a7-42ba69f1bb3d", status: "SENT", try: [] },
];

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 390, height: 844 });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  for (const t of TARGETS) {
    await openPo(page, t.id);
    const s = await statusOf(page);
    const b = await buttons(page);
    console.log(`\n=== PO ${t.id.slice(0, 8)} (api says ${t.status}) ===`);
    console.log("  page:", s.head.slice(0, 260));
    console.log("  buttons:", JSON.stringify(b));
    await shot(page, `po-${t.status}-${persona}`);
    for (const label of t.try) {
      console.log(`  >>> clicking "${label}"`);
      const r = await act(page, t.id, label);
      console.log("  result:", JSON.stringify(r).slice(0, 900));
      await shot(page, `po-${t.status}-after-${label}-${persona}`);
    }
  }
  await browser.close();
}
main();
