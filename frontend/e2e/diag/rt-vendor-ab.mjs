/*
 * RED TEAM #12 — A/B: create two vendors in one session, identical except the email.
 * A = valid email, B = malformed email. Reload. Which survives?
 * This isolates whether the vanishing write is caused by the unvalidated email.
 */
import { go, login, browser, save, shot, openDialog, BASE } from "./rt-lib.mjs";

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const posts = [];
  page.on("response", async (r) => {
    if (r.request().method() === "POST" && r.url().includes("/vendors")) {
      let body = null; try { body = (await r.text()).slice(0, 800); } catch {}
      posts.push({ status: r.status(), body });
    }
  });
  const a = await login(page, "owner"); if (!a.ok) process.exit(1);

  const stamp = Date.now().toString().slice(-6);
  const A = `RTGOOD${stamp}`, B = `RTBADMAIL${stamp}`;
  const out = { A, B, posts: [], toasts: {} };

  for (const [name, email] of [[A, `ok${stamp}@vendor.pk`], [B, "not-an-email"]]) {
    await go(page, "/app/purchasing/vendors", "owner", { wait: 3500 });
    const o = await openDialog(page, "Add vendor");
    if (!o.opened) { console.log("dialog failed for", name); continue; }
    await page.locator('[data-slot="dialog-content"] [name="name"]').first().fill(name);
    await page.locator('[data-slot="dialog-content"] [name="email"]').first().fill(email);
    await page.locator('[data-slot="dialog-content"] button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
    out.toasts[name] = await page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((e) => e.textContent.trim().slice(0, 150)));
    console.log("created", name, "email=", email, "toast:", out.toasts[name]);
  }
  out.posts = posts;

  // hard reload, read the API list
  let listBody = null;
  page.on("response", async (r) => {
    if (r.request().method() === "GET" && r.url().includes("/api/v1/purchasing/vendors")) {
      try { listBody = await r.text(); } catch {}
    }
  });
  await page.goto(`${BASE}/app/purchasing/vendors`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5500);
  const names = (() => { try { return JSON.parse(listBody).data.map((v) => v.name); } catch { return []; } })();
  out.apiNames = names;
  out.aSurvived = names.includes(A);
  out.bSurvived = names.includes(B);
  out.uiText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  out.uiHasA = out.uiText.includes(A);
  out.uiHasB = out.uiText.includes(B);
  await shot(page, "vendor-ab-after-reload", "persist");

  console.log("POST statuses:", posts.map((p) => p.status));
  console.log("A (valid email)   survived in API:", out.aSurvived, "| visible in UI:", out.uiHasA);
  console.log("B (invalid email) survived in API:", out.bSurvived, "| visible in UI:", out.uiHasB);
  console.log("API vendor count:", names.length);
  save("vendor-ab.json", out);
  await b.close();
};
run();
