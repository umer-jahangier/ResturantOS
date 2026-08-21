/* Do the 21 raw <select>s honour the dark theme, or render as native light controls? */
import { chromium } from "@playwright/test";
import { login, settle, shot, saveJson } from "./uiq-lib.mjs";

const browser = await chromium.launch();
const out = [];
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  const page = await ctx.newPage();
  if (!(await login(page, "owner")).ok) { console.log("login failed", theme); continue; }
  for (const [name, route] of [["ingredients", "/app/inventory/ingredients"], ["hr-attendance", "/app/hr/attendance"]]) {
    const st = await settle(page, route, "owner");
    if (!st.clean) { console.log("skip", name, theme); continue; }
    const data = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const inputs = [...document.querySelectorAll("input[type=text],input[type=search]")].filter((e) => e.getBoundingClientRect().width > 0);
      const sels = [...document.querySelectorAll("select")].filter((e) => e.getBoundingClientRect().width > 0);
      const g = (e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, fg: c.color, border: c.borderColor, h: Math.round(e.getBoundingClientRect().height), radius: c.borderRadius, appearance: c.appearance }; };
      return { bodyBg: body.backgroundColor, selects: sels.map(g), inputs: inputs.map(g) };
    });
    out.push({ theme, name, ...data });
    console.log(`${theme}/${name}: body=${data.bodyBg}`);
    console.log(`   text inputs (${data.inputs.length}):`, JSON.stringify(data.inputs.slice(0, 2)));
    console.log(`   raw selects (${data.selects.length}):`, JSON.stringify(data.selects.slice(0, 3)));
    await shot(page, `selects-${name}-${theme}`, "selects");
  }
  await ctx.close();
}
saveJson("selects.json", out);
await browser.close();
