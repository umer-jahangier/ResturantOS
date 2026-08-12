/* S8 RE-OPEN — independent drive. Step 1: what the OWNER actually sees on /app/settings/printers. */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { newBrowser, newPage, login, go, shot, PEOPLE, apiGet, branchOf, printCount } from "../s8/lib.mjs";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S8-reopen");
mkdirSync(OUT, { recursive: true });

const rec = { steps: [] };
const say = (k, v) => {
  console.log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  rec.steps.push({ k, v });
};

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  const branchId = await branchOf(page);
  say("branchId", branchId);

  const t = await go(page, "/app/settings/printers", { waitMs: 6000 });
  say("pageTrouble", t);
  await page.screenshot({ path: `${OUT}/r01a-printers.png` });

  // What does the API say the registry currently is?
  const cfg = await apiGet(page, `/api/v1/pos/branches/${branchId}/receipt-config`);
  say("receiptConfig.status", cfg.status);
  const printers = cfg.body?.data?.printers ?? cfg.body?.printers ?? [];
  say(
    "registry",
    printers.map((p) => ({
      id: p.id,
      role: p.role,
      transport: p.transport,
      host: p.host,
      port: p.port,
      systemPrinterName: p.systemPrinterName,
      stationCode: p.stationCode,
    })),
  );

  // Agents + their reported devices, straight off the API
  const agents = await apiGet(page, `/api/v1/pos/print-agents?branchId=${branchId}`);
  say("agents.status", agents.status);
  const list = agents.body?.data ?? agents.body ?? [];
  const live = (Array.isArray(list) ? list : []).filter((a) => !a.revokedAt);
  say("agents.total/live", { total: Array.isArray(list) ? list.length : -1, live: live.length });
  say(
    "agents.withDevices",
    live
      .filter((a) => a.devices)
      .map((a) => ({
        label: a.label,
        lastSeenAt: a.lastSeenAt,
        devicesReportedAt: a.devicesReportedAt,
        devices: (a.devices ?? []).map((d) => `${d.name}|${d.state}${d.isDefault ? "|DEFAULT" : ""}`),
        unavailable: a.devicesUnavailable,
      })),
  );

  // Health endpoint, as owner
  const health = await apiGet(page, `/api/v1/pos/printers/health?branchId=${branchId}`);
  say("health.status", health.status);
  say("health.body", health.body?.data ?? health.body);

  // Now the DOM: every printer row, its transport, and what control the queue field is.
  const dom = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="printer-row"]'));
    return {
      rowCount: rows.length,
      rows: rows.map((r) => {
        const pid = r.getAttribute("data-printer-id");
        const transport = r.querySelector(`#transport-${CSS.escape(pid)}`);
        const queue = r.querySelector('[data-testid="system-printer-picker"]');
        const host = r.querySelector(`#host-${CSS.escape(pid)}`);
        return {
          pid,
          transport: transport ? transport.value : null,
          host: host ? host.value : null,
          queueTag: queue ? queue.tagName : null,
          queueValue: queue ? queue.value : null,
          queueOptions: queue
            ? Array.from(queue.querySelectorAll("option")).map((o) => `${o.value}::${o.textContent.trim()}`)
            : null,
          delivery: (r.querySelector('[data-testid="printer-delivery"]')?.textContent ?? "").trim(),
        };
      }),
      failingAlert: (document.querySelector('[data-testid="printers-failing"]')?.innerText ?? "").trim(),
      unrouted: (document.querySelector('[data-testid="unrouted-stations"]')?.innerText ?? "").trim(),
      healthUnavailable: (
        document.querySelector('[data-testid="printer-health-unavailable"]')?.innerText ?? ""
      ).trim(),
      agentReach: (document.querySelector('[data-testid="agent-reachability"]')?.innerText ?? "").trim(),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        (n.textContent ?? "").trim().slice(0, 240),
      ),
    };
  });
  say("dom", dom);
  say("printCalls", await printCount(page));
} catch (e) {
  say("ERROR", String(e));
  rec.error = String(e);
} finally {
  writeFileSync(`${OUT}/r01-owner-observe.json`, JSON.stringify(rec, null, 2));
  await browser.close();
}
