import { readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
// Playwright lives in the app workspace; borrow it rather than duplicating the download.
const { chromium } = await import(
  pathToFileURL(join(root, "..", "frontend", "node_modules", "@playwright", "test", "index.mjs")).href
);
const srcDir = join(root, "src");
const outDir = join(root, "out");
mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);
const pages = readdirSync(srcDir)
  .filter((f) => f.endsWith(".html"))
  .filter((f) => !only.length || only.some((o) => f.includes(o)))
  .sort();

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  reducedMotion: "reduce",
});
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()}`));
page.on("pageerror", (e) => errors.push(`${e.message}`));

for (const file of pages) {
  errors.length = 0;
  await page.goto(pathToFileURL(join(srcDir, file)).href, { waitUntil: "load" });
  await page.waitForSelector("body[data-ready='1']", { timeout: 5000 });
  await page.evaluate(() => document.fonts.ready);

  // Guard: nothing may scroll, clip, or fall outside the 1600x1000 frame.
  // `overflow:hidden` hides scroll overflow, so geometry is checked too.
  const bad = await page.evaluate(() => {
    const out = [];
    const name = (el) =>
      el.querySelector?.(".card-t")?.textContent.trim().slice(0, 34) ||
      (el.getAttribute("class") || "").split(" ")[0] ||
      el.tagName.toLowerCase();

    for (const el of document.querySelectorAll(".card, .content, .feed, .sidebar, .nav, .ai-band")) {
      const over = el.scrollHeight - el.clientHeight;
      if (over > 2) out.push(`"${name(el)}" content overflows by ${over}px`);
    }
    // any element whose box escapes the frame
    for (const el of document.querySelectorAll("body *")) {
      if (el.ownerSVGElement) continue; // SVG internals are clipped by the viewBox
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0) continue;
      if (r.bottom > 1001.5) out.push(`"${name(el)}" bottom at ${Math.round(r.bottom)} (>1000)`);
      if (r.right > 1601.5) out.push(`"${name(el)}" right at ${Math.round(r.right)} (>1600)`);
    }
    return [...new Set(out)].slice(0, 6);
  });

  const png = file.replace(/\.html$/, ".png");
  await page.screenshot({ path: join(outDir, png) });
  const flags = [...errors, ...bad];
  console.log(`${flags.length ? "!" : "✓"} ${png}${flags.length ? "\n    " + flags.join("\n    ") : ""}`);
}

await browser.close();
