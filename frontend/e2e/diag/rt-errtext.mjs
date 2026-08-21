/* RED TEAM #17 — capture the exact error copy on the five failing routes. */
import { go, login, browser, save, shot } from "./rt-lib.mjs";

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const a = await login(page, "owner"); if (!a.ok) { console.error("login fail", a); process.exit(1); }
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("localhost:8080")) failed.push(`${r.status()} ${r.url().replace("http://localhost:8080", "")}`); });
  const out = [];
  for (const route of ["/app/menu/items", "/app/tables", "/app/stations"]) {
    failed.length = 0;
    await page.goto(`http://localhost:3000${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    const t = await page.evaluate(() => ({
      url: location.pathname,
      body: document.body.innerText.slice(0, 900),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim().slice(0, 200)),
      retryButtons: [...document.querySelectorAll("button")].filter((e) => /try again|retry|reload/i.test(e.textContent)).map((e) => e.textContent.trim()),
    }));
    out.push({ route, ...t, failedRequests: [...failed] });
    await shot(page, route.replace(/\W+/g, "_"), "errtext");
    console.log("=====", route, "\nfailedReqs:", failed, "\nalerts:", JSON.stringify(t.alerts), "\nretry:", JSON.stringify(t.retryButtons), "\nBODY:", t.body.slice(0, 500).replace(/\n+/g, " | "));
  }
  save("errtext.json", out);
  await b.close();
};
run();
