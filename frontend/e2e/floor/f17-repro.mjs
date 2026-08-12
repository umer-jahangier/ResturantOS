/*
 * F17 — reproduce "nothing ages a ticket off a KDS board".
 * Persona: kitchen@terrace.local (KITCHEN_STAFF, 2 permissions).
 */
import { newBrowser, newPage, login, go, shot, apiGet, PEOPLE, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F17");
mkdirSync(OUT, { recursive: true });

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.kitchen);

const t1 = await go(page, "/app/kitchen", { waitMs: 4500 });
log("  kitchen index trouble:", JSON.stringify(t1));
await page.screenshot({ path: `${OUT}/01-station-picker.png` });

const token = await page.evaluate(async () => {
  const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json().catch(() => null);
  return j?.accessToken ?? j?.data?.accessToken ?? null;
});
const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
log("  claims:", JSON.stringify({ sub: claims.sub, branchId: claims.branchId, perms: claims.permissions ?? claims.perms }));

const branchId = claims.branchId ?? claims.branch_id;
const stations = await apiGet(page, `/api/v1/kitchen/kds/stations?branchId=${branchId}`, token);
log("  stations:", stations.status, JSON.stringify(stations.body?.map?.((s) => s.code) ?? stations.body));

const tix = await apiGet(
  page,
  `/api/v1/kitchen/kds/tickets?branchId=${branchId}&stationCode=DEFAULT&page=0&size=200`,
  token,
);
const content = tix.body?.content ?? [];
const now = Date.now();
const ages = content
  .map((t) => ({ no: t.orderNo, st: t.status, recv: t.receivedAt, hrs: (now - Date.parse(t.receivedAt)) / 3600000 }))
  .sort((a, b) => b.hrs - a.hrs);
log("  DEFAULT total:", tix.body?.totalElements, "pages:", tix.body?.totalPages);
log("  oldest 5:", JSON.stringify(ages.slice(0, 5), null, 1));
log("  newest 5:", JSON.stringify(ages.slice(-5), null, 1));
const older24 = ages.filter((a) => a.hrs > 24).length;
log(`  tickets older than 24h on DEFAULT: ${older24} / ${ages.length}`);

// walk to the board itself
const t2 = await go(page, "/app/kitchen/DEFAULT", { waitMs: 5000 });
log("  DEFAULT board trouble:", JSON.stringify(t2));
await page.screenshot({ path: `${OUT}/02-default-board.png` });

const probe = await page.evaluate(() => {
  const text = document.body.innerText;
  const buttons = Array.from(document.querySelectorAll("button")).map((b) =>
    (b.innerText || b.getAttribute("aria-label") || "").trim(),
  );
  const oldest = (text.match(/Oldest[^\n]*/g) || []).slice(0, 3);
  return {
    buttons: buttons.filter(Boolean),
    oldest,
    hasClearWord: /clear|purge|archive|expire|stale|age off/i.test(text),
    pager: (text.match(/\d+\s*\/\s*\d+/g) || []).slice(0, 6),
  };
});
log("  board probe:", JSON.stringify(probe, null, 1));

writeFileSync(`${OUT}/_repro.json`, JSON.stringify({ branchId, stations: stations.body, ages, probe }, null, 2));
await browser.close();
