/*
 * RED TEAM #13 — the POST returns a UUID. Does that row exist?
 * Create one vendor, capture its id from the POST body, then GET it by id from inside the
 * same authenticated browser session, and GET the list. Row-never-written vs list-filtered.
 */
import { go, login, browser, save, shot, openDialog, BASE } from "./rt-lib.mjs";

const run = async () => {
  const { b, page } = await browser(1440, 900);
  let created = null;
  let listUrl = null;
  page.on("response", async (r) => {
    const u = r.url();
    if (r.request().method() === "POST" && u.includes("/vendors")) {
      try { created = JSON.parse(await r.text()); } catch {}
    }
    if (r.request().method() === "GET" && u.includes("/vendors") && !u.includes("localhost:3000")) listUrl = u;
  });
  const a = await login(page, "owner"); if (!a.ok) process.exit(1);
  await go(page, "/app/purchasing/vendors", "owner", { wait: 3500 });

  const name = "RTFETCH" + Date.now().toString().slice(-6);
  const o = await openDialog(page, "Add vendor");
  if (!o.opened) { console.log("no dialog"); await b.close(); return; }
  await page.locator('[data-slot="dialog-content"] [name="name"]').first().fill(name);
  await page.locator('[data-slot="dialog-content"] [name="email"]').first().fill(`x${Date.now() % 1000}@vendor.pk`);
  await page.locator('[data-slot="dialog-content"] button[type="submit"]').first().click();
  await page.waitForTimeout(4000);

  const out = { name, created, listUrl };
  const id = created?.data?.id;
  out.id = id;
  console.log("POST returned id:", id, "listUrl the app uses:", listUrl);

  if (id) {
    // wait, then read it back through the app's own authenticated fetch
    await page.waitForTimeout(3000);
    out.byId = await page.evaluate(async (vid) => {
      const tryUrls = [`/api/v1/purchasing/vendors/${vid}`, `http://localhost:8080/api/v1/purchasing/vendors/${vid}`];
      const res = [];
      for (const u of tryUrls) {
        try {
          const r = await fetch(u, { credentials: "include" });
          res.push({ u, status: r.status, body: (await r.text()).slice(0, 400) });
        } catch (e) { res.push({ u, err: String(e).slice(0, 120) }); }
      }
      return res;
    }, id);
    console.log("GET by id:", JSON.stringify(out.byId, null, 1));

    out.listAgain = await page.evaluate(async (n) => {
      for (const u of ["/api/v1/purchasing/vendors", "http://localhost:8080/api/v1/purchasing/vendors"]) {
        try {
          const r = await fetch(u, { credentials: "include" });
          const t = await r.text();
          if (r.status === 200) return { u, status: r.status, contains: t.includes(n), count: (JSON.parse(t).data || []).length };
        } catch (e) { /* next */ }
      }
      return null;
    }, name);
    console.log("LIST again:", JSON.stringify(out.listAgain));
  }
  save("vendor-fetch.json", out);
  await shot(page, "vendor-fetch", "persist");
  await b.close();
};
run();
