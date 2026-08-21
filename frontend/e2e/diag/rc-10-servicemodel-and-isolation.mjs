/*
 * RECHECK G — (1) does a terminal's "service model" change anything at the till?
 *             (2) can the fresh tenant read the established tenant's data?
 * argv: <ownerEmail> <ownerPassword> <ownerTotp>
 */
import { launch, loginAs, visit, OUT, BASE, api, tokenForRecord, PERSONAS } from "./rc-lib.mjs";

const OWNER = { slug: "", email: process.argv[2], password: process.argv[3], totp: process.argv[4] };
const STAMP = Date.now().toString().slice(-4);

const { browser, page } = await launch();
try {
  await loginAs(page, OWNER, "fresh-owner");

  // ── (1) terminals ──────────────────────────────────────────────────────────────────
  await visit(page, "/app/terminals", "I1-terminals", { chars: 900 });
  const addBtn = page.getByRole("button", { name: /new terminal|add terminal|create terminal/i });
  console.log("create affordance:", await addBtn.count());
  for (const [code, model] of [[`KIOSK${STAMP}`, "SELF_SERVE"], [`WAITER${STAMP}`, "TABLE_SERVICE"]]) {
    await addBtn.first().click();
    await page.waitForTimeout(2500);
    const d = page.locator('[role="dialog"]').last();
    console.log(`\n[${model}] dialog box:`, JSON.stringify(await d.boundingBox()));
    const fieldMeta = await d.locator("input, select").evaluateAll((els) =>
      els.map((e) => ({ id: e.id, name: e.name, tag: e.tagName })),
    );
    console.log(`[${model}] fields:`, JSON.stringify(fieldMeta));
    await d.locator("input").first().fill(code);
    await d.locator("input").nth(1).fill(`${model} ${STAMP}`);
    const selects = d.locator("select");
    console.log(`[${model}] selects:`, await selects.count());
    for (let i = 0; i < (await selects.count()); i++) {
      const opts = await selects.nth(i).locator("option").evaluateAll((o) => o.map((x) => x.value));
      if (opts.includes(model)) { await selects.nth(i).selectOption(model); console.log(`  set select#${i} = ${model}`); }
    }
    await page.screenshot({ path: `${OUT}/I2-${model}-dialog.png`, fullPage: true });
    const dBtns = await d.locator("button").allInnerTexts();
    console.log(`[${model}] dialog buttons:`, JSON.stringify(dBtns.map((s) => s.replace(/\s+/g, " ").trim())));
    console.log(`[${model}] dialog text:`, (await d.innerText()).replace(/\s+/g, " ").slice(0, 700));
    await d.getByRole("button", { name: "Add terminal", exact: true }).click();
    await page.waitForTimeout(5000);
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    console.log(`[${model}] terminal list now contains it?`, t.includes(code), "|", t.slice(t.indexOf("Terminals"), t.indexOf("Terminals") + 400));
  }
  await page.screenshot({ path: `${OUT}/I3-terminals-after.png`, fullPage: true });

  // Now the till itself. Is a terminal even selectable? Does anything differ?
  await visit(page, "/app/pos", "I4-pos", { chars: 1400, wait: 7000 });
  const posText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("\nPOS mentions a terminal name?", /KIOSK|WAITER/.test(posText));
  console.log("POS view tabs:", JSON.stringify(await page.getByRole("tab").allInnerTexts()));
  const posSelects = await page.locator("select").evaluateAll((els) => els.map((e) => ({ id: e.id, name: e.name })));
  console.log("POS selects (any terminal picker?):", JSON.stringify(posSelects));
  console.log("POS buttons:", JSON.stringify((await page.locator("button").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40)));
  console.log("Table picker present regardless of service model?", /floor|table/i.test(posText));

  // ── (2) tenant isolation ───────────────────────────────────────────────────────────
  console.log("\n=== TENANT ISOLATION ===");
  const freshTok = await tokenForRecord(OWNER);
  const terraceTok = await tokenForRecord(PERSONAS.owner);
  const terraceBranches = await api("GET", "/api/v1/branches", terraceTok);
  const tb = terraceBranches.json?.data ?? terraceBranches.json;
  const victimBranchId = Array.isArray(tb) ? tb[0]?.id : tb?.content?.[0]?.id;
  console.log("Floating Terrace branch id:", victimBranchId);

  const probes = [
    ["GET", `/api/v1/branches/${victimBranchId}`, undefined],
    ["PUT", `/api/v1/branches/${victimBranchId}`, { phone: "+92-000-HACKED" }],
    ["GET", "/api/v1/menu/items?page=0&size=3", undefined],
  ];
  for (const [m, p, b] of probes) {
    const r = await api(m, p, freshTok, b);
    console.log(`  fresh-tenant token ${m} ${p} -> ${r.status} ${r.text.slice(0, 160)}`);
  }
  // control: the rightful owner can read it
  const ok = await api("GET", `/api/v1/branches/${victimBranchId}`, terraceTok);
  console.log(`  CONTROL: terrace owner GET same branch -> ${ok.status}`);
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/I-FAIL.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
