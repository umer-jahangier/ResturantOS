/* Was "leakedBar" a real leak, or just older tickets that legitimately live on GRILL? */
import { newBrowser, newPage, login, go, shot, log, writeJson } from "./lib.mjs";

const COOK = {
  slug: "floating-terrace",
  email: process.env.COOK_EMAIL,
  password: "Grill#Cook1234",
};
const ORDER_NO = process.env.ORDER_NO || "ORD-20260812-0353";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, COOK);
  await go(page, "/app/kitchen/GRILL", { waitMs: 8000 });
  const r = await page.evaluate((no) => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    // Every ticket block, split on the ORD- marker so an item can be tied to its own check.
    const blocks = text.split(/(?=ORD-\d{8}-\d{4})/).filter((b) => /^ORD-/.test(b));
    const mine = blocks.filter((b) => b.startsWith(no));
    return {
      pinacoladaAnywhere: /Pinacolada/.test(text),
      freshLimeAnywhere: /Fresh Lime/.test(text),
      myBlocks: mine.map((b) => b.slice(0, 200)),
      totalBlocks: blocks.length,
      pager: /(\d+) \/ (\d+)/.exec(text)?.[0] ?? null,
    };
  }, ORDER_NO);
  log("  GRILL as the scoped cook:", JSON.stringify(r, null, 1));
  await shot(page, "10-grill-leakcheck");
  writeJson("10-leak-check.json", r);
} finally {
  await browser.close();
}
