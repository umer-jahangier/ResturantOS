/* DAY 2 — step 1: OPEN. Owner signs in. Manager opens a till with a float. */
import { newBrowser, newPage, login, PEOPLE, go, shot, apiGet, saveState, loadState, finding, log } from "./lib.mjs";

const browser = await newBrowser();

// ── OWNER ────────────────────────────────────────────────────────────────────
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
let t = await go(owner, "/app/dashboard", { waitMs: 4000 });
await shot(owner, "01a-owner-dashboard");
log("  owner dashboard trouble:", JSON.stringify(t.bad), "alerts:", t.alerts.length);
const ownerHead = await owner.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400));
log("  owner sees:", ownerHead);

// which branch / tz
const me = await apiGet(owner, "/api/v1/users/me");
log("  /users/me ->", me.status, JSON.stringify(me.body).slice(0, 400));

// ── MANAGER opens a till ─────────────────────────────────────────────────────
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
t = await go(mgr, "/app/pos/tills", { waitMs: 4000 });
await shot(mgr, "01b-manager-tills");
const tillScreen = await mgr.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter(Boolean);
  const inputs = Array.from(document.querySelectorAll("input,select")).map((i) => ({
    name: i.getAttribute("name") || i.id,
    type: i.getAttribute("type") || i.tagName,
    label: (i.closest("label")?.textContent || document.querySelector(`label[for="${i.id}"]`)?.textContent || "").trim().slice(0, 60),
    placeholder: i.getAttribute("placeholder"),
  }));
  return { btns, inputs, text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1200) };
});
log("  till screen buttons:", JSON.stringify(tillScreen.btns));
log("  till screen inputs:", JSON.stringify(tillScreen.inputs));
log("  till screen text:", tillScreen.text);

saveState({ openProbe: { ownerHead, tillScreen, me: me.body } });
await browser.close();
