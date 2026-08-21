/* S1 re-open, step 6: what the KITCHEN actually received, board by board, in a real browser. */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log, writeJson, loadState,
} from "./lib.mjs";

const st = loadState();
const BRANCH = st.branchId;
const ORDER_NO = process.env.ORDER_NO || "ORD-20260812-0345";

const browser = await newBrowser();
const page = await newPage(browser);
const out = { orderNo: ORDER_NO, boards: {}, order: null };

try {
  // --- the check itself, over the cashier's bearer ---
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);
  const list = await apiGet(cash, `/api/v1/pos/orders?branchId=${BRANCH}&size=5`);
  const rows = list.body?.data?.content ?? list.body?.data ?? list.body?.content ?? [];
  const mine = (Array.isArray(rows) ? rows : []).find((o) => o.orderNo === ORDER_NO) ?? rows[0];
  log(`  orders list ${list.status}, newest: ${JSON.stringify((Array.isArray(rows) ? rows : []).slice(0, 3).map((o) => o.orderNo))}`);
  if (mine) {
    const d = await apiGet(cash, `/api/v1/pos/orders/${mine.id}?branchId=${BRANCH}`);
    const dd = d.body?.data ?? d.body;
    out.order = {
      orderNo: dd?.orderNo, status: dd?.status, id: dd?.id,
      items: (dd?.items ?? dd?.lines ?? []).map((l) => ({
        name: l.itemName ?? l.menuItemName ?? l.name, qty: l.quantity ?? l.qty, status: l.status,
      })),
      subtotal: dd?.subtotalPaisa, total: dd?.totalPaisa,
    };
    log(`  order ${out.order.orderNo} status=${out.order.status} lines=${JSON.stringify(out.order.items)}`);
  }
  await cash.close();

  // --- the boards, as the kitchen persona, in the browser ---
  await login(page, PEOPLE.kitchen);
  const codes = ["BAR", "GRILL", "PANTRY1", "DEFAULT"];
  for (const code of codes) {
    const t = await go(page, `/app/kitchen/${code}`, { waitMs: 6000, allowTrouble: true });
    const dom = await page.evaluate((wanted) => {
      const text = (document.body.innerText || "").replace(/\s+/g, " ");
      const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket-card"], article, [data-ticket-id]'))
        .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim())
        .filter((s) => /ORD-/.test(s));
      return {
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
        mine: cards.filter((c) => c.includes(wanted)),
        cardCount: cards.length,
        hasNoStations: /No active stations configured/i.test(text),
        mentions: {
          Pinacolada: text.includes("Pinacolada"),
          "Chicken Karahi": text.includes("Chicken Karahi"),
          "Mutton Biryani": text.includes("Mutton Biryani"),
          "Chicken Samosa": text.includes("Chicken Samosa"),
        },
        head: text.slice(0, 200),
      };
    }, ORDER_NO);
    out.boards[code] = { ...dom, trouble: t.bad };
    await shot(page, `06-board-${code}`);
    log(`  [${code}] h1=${JSON.stringify(dom.h1)} cards=${dom.cardCount} mineOnThisBoard=${dom.mine.length}`);
    log(`      my cards: ${JSON.stringify(dom.mine.map((m) => m.slice(0, 120)))}`);
    log(`      mentions anywhere on board: ${JSON.stringify(dom.mentions)} alerts=${JSON.stringify(dom.alerts)}`);
  }

  writeJson("06-boards.json", out);
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(page, "06z-failure");
  process.exitCode = 1;
} finally {
  await browser.close();
}
