/*
 * Painted-extent collision check on the KDS board header.
 *
 * Box comparison is not enough — phase 38 measured this exact trap: every box was dutifully
 * inside its parent while the TEXT painted straight across its neighbour. So this compares
 * `left + scrollWidth` (what is actually drawn) and flags any element whose own content
 * overflows its box, plus any two same-row siblings whose painted extents intersect.
 */
import { newBrowser, newPage, login, PEOPLE } from "../shift/lib.mjs";
import { go, shot, waitForPicker, waitForBoard } from "./f3-lib.mjs";

const STATION = process.argv[2] ?? "PANTRY1";
const TAG = process.argv[3] ?? "before";

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.kitchen);
await go(page, "/app/kitchen", { waitMs: 2000 });
await waitForPicker(page);

let bad = 0;
for (const [w, h] of [[390, 844], [768, 1024], [1440, 950]]) {
  await page.setViewportSize({ width: w, height: h });
  await go(page, `/app/kitchen/${STATION}`, { waitMs: 1500 });
  await waitForBoard(page);
  const m = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="kds-board"] > header');
    if (!header) return { error: "no header" };
    // Every leaf control/text in the header, with what it PAINTS.
    const nodes = Array.from(header.querySelectorAll("h1, span, button, select")).filter(
      (n) => (n.innerText || "").trim().length > 0 && n.getClientRects().length > 0,
    );
    const boxes = nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return {
        text: (n.innerText || "").trim().replace(/\s+/g, " ").slice(0, 22),
        tag: n.tagName,
        left: Math.round(r.left),
        right: Math.round(r.right),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        // What the content needs vs what the box gives it.
        scrollW: n.scrollWidth,
        clientW: n.clientWidth,
        // A <select> clips its own text, and a `truncate` element ends in an ellipsis at its
        // box edge — for BOTH, `left + scrollWidth` over-reports what is drawn. Painted
        // extent is the box for those, and left+scrollWidth for everything else.
        paintedRight:
          n.tagName === "SELECT" || getComputedStyle(n).textOverflow === "ellipsis"
            ? Math.round(r.right)
            : Math.round(r.left + n.scrollWidth),
        truncates: getComputedStyle(n).textOverflow === "ellipsis",
      };
    });
    const overflowing = boxes.filter((b) => !b.truncates && b.scrollW > b.clientW + 1);
    // Same visual row = vertical ranges intersect.
    const collisions = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.bottom <= b.top || b.bottom <= a.top) continue; // different rows
        // Ignore ancestor/descendant pairs (a span inside a button).
        const na = document.querySelectorAll("*");
        void na;
        const aEl = nodes[i];
        const bEl = nodes[j];
        if (aEl.contains(bEl) || bEl.contains(aEl)) continue;
        const aR = Math.max(a.right, a.paintedRight);
        const bR = Math.max(b.right, b.paintedRight);
        if (a.left < bR && b.left < aR) collisions.push([a.text, b.text]);
      }
    }
    return {
      headerHeight: Math.round(header.getBoundingClientRect().height),
      boxes,
      overflowing: overflowing.map((b) => `${b.text} needs ${b.scrollW} has ${b.clientW}`),
      collisions,
    };
  });
  const fail = (m.overflowing?.length ?? 0) + (m.collisions?.length ?? 0);
  bad += fail;
  console.log(`\n${w}px  headerHeight=${m.headerHeight}`);
  console.log(`  overflowing: ${JSON.stringify(m.overflowing)}`);
  console.log(`  collisions : ${JSON.stringify(m.collisions)}`);
  if (fail) console.log(`  boxes: ${JSON.stringify(m.boxes, null, 1)}`);
  await shot(page, `19-${TAG}-header-collide-${w}`);
}
console.log(`\n${bad === 0 ? "CLEAN" : `${bad} painted-extent problem(s)`}`);
await browser.close();
if (bad) process.exitCode = 1;
