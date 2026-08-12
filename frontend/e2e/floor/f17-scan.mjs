import { newBrowser, newPage, login, apiGet, PEOPLE, log } from "../shift/lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.kitchen);
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
const branchId = claims.branch_id ?? claims.branchId;

const stations = await apiGet(page, `/api/v1/kitchen/kds/stations?branchId=${branchId}`, token);
for (const s of stations.body ?? []) {
  const r = await apiGet(
    page,
    `/api/v1/kitchen/kds/tickets/stale?branchId=${branchId}&stationCode=${s.code}`,
    token,
  );
  const d = r.body?.data;
  log(
    `  ${s.code.padEnd(10)} stale=${String(d?.ticketCount).padStart(3)} items=${String(d?.itemCount).padStart(3)} finished=${d?.finishedTicketCount} oldest=${d?.oldestReceivedAt ?? "-"}`,
  );
}
const all = await apiGet(page, `/api/v1/kitchen/kds/tickets/stale?branchId=${branchId}`, token);
log("  BRANCH-WIDE:", JSON.stringify({
  tickets: all.body?.data?.ticketCount,
  items: all.body?.data?.itemCount,
  days: all.body?.data?.days,
  tz: all.body?.data?.branchTimezone,
  dayStart: all.body?.data?.currentBusinessDayStartedAt,
}));
await browser.close();
