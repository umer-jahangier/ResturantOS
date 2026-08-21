import { P, login, newPage, shot, visit } from "./hrrt-lib.mjs";

const { browser, page } = await newPage();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/v1\/hr\//.test(u)) return;
  let t = "";
  if (r.status() >= 400) { try { t = (await r.text()).slice(0, 220); } catch {} }
  if (r.request().method() !== "GET" || r.status() >= 400)
    net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}${t ? " :: " + t : ""}`);
});
const toasts = async () =>
  (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).map((s) => s.replace(/\n/g, " | "));
const stamp = String(Date.now()).slice(-5);

try {
  await login(page, P.owner);
  await visit(page, "/app/hr/schedule", { persona: P.owner });

  // The shift creator is an inline strip, not a dialog.
  const strip = page.locator("main .rounded.border").first();
  const ins = strip.locator("input");
  console.log("[shift] inline inputs:", await ins.count(),
    JSON.stringify(await ins.evaluateAll((e) => e.map((x) => ({ ph: x.placeholder, t: x.type, v: x.value })))));
  await ins.nth(0).fill(`RTShift${stamp}`);
  await ins.nth(1).fill("Waiter");
  await ins.nth(2).fill("16:00");
  await ins.nth(3).fill("23:00");
  await ins.nth(4).fill("1,2,3");
  await shot(page, "ros-01-shift-form");
  await strip.getByRole("button", { name: /Add shift/i }).click();
  await page.waitForTimeout(4000);
  console.log("[shift] toasts:", JSON.stringify(await toasts()));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const grid = await page.locator("main").innerText();
  console.log("[shift] after reload, 16:00 shift present:", /16:00/.test(grid) ? "YES" : "NO");
  await shot(page, "ros-02-shift-created");

  // What does a free-text "Days (1-7)" do with human input?
  await ins.nth(0).fill(`RTBad${stamp}`);
  await ins.nth(4).fill("Mon,Wed,Fri");
  await strip.getByRole("button", { name: /Add shift/i }).click();
  await page.waitForTimeout(3500);
  console.log("[shift] toasts after typing day NAMES:", JSON.stringify(await toasts()));
  await shot(page, "ros-03-shift-daynames");

  // ---------- DRAG ASSIGN ----------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const chip = page.locator('[draggable="true"]').first();
  const nChips = await page.locator('[draggable="true"]').count();
  console.log("[drag] draggable elements:", nChips);
  if (nChips) {
    console.log("[drag] first chip text:", (await chip.innerText()).slice(0, 60));
    const cells = page.locator("main td");
    console.log("[drag] td count:", await cells.count());
    const src = await chip.boundingBox();
    // Target an empty cell in the new shift row.
    let target = null;
    const n = await cells.count();
    for (let i = 0; i < n; i++) {
      const tx = (await cells.nth(i).innerText()).trim();
      const bb = await cells.nth(i).boundingBox();
      if (tx === "" && bb && bb.width > 20) { target = bb; console.log("[drag] chose empty cell index", i); break; }
    }
    if (src && target) {
      await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 25 });
      await page.mouse.up();
      await page.waitForTimeout(4000);
      console.log("[drag] toasts:", JSON.stringify(await toasts()));
      await shot(page, "ros-04-after-drag");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4500);
      await shot(page, "ros-05-after-drag-reload");
      console.log("[drag] grid after reload:\n" + (await page.locator("main table").innerText()).slice(0, 900));
    }
  }

  // Is there any keyboard/click alternative to drag?
  const gridButtons = await page.locator("main table button, main table select, main table a").allInnerTexts().catch(() => []);
  console.log("[drag] click-based controls inside the grid:", JSON.stringify(gridButtons));

  // ---------- ATTENDANCE DEVICE ADMIN UI? ----------
  for (const r of ["/app/hr/devices", "/app/hr/settings/devices", "/app/settings/devices", "/app/hr/attendance/devices", "/app/hr/timesheet", "/app/hr/leave", "/app/hr/reports"]) {
    const s = await visit(page, r, { persona: P.owner, waitMs: 3000, tries: 1 });
    console.log(`[route] ${r} -> ${s.notfound ? "404 NOT FOUND" : s.denied ? "denied" : "reachable"} (${s.url})`);
  }
} catch (e) {
  console.log("FATAL", String(e).slice(0, 600));
  await shot(page, "ros-FATAL");
} finally {
  console.log("\n[network]");
  for (const l of net) console.log("   " + l);
  await browser.close();
}
