/* Step 11 — the closing state of the Printers screen: a real agent, really connected. */
import { newBrowser, newPage, login, go, shot, PEOPLE } from "./lib.mjs";
const b = await newBrowser(); const p = await newPage(b);
try {
  await login(p, PEOPLE.owner);
  await go(p, "/app/settings/printers", { waitMs: 6000, allowTrouble: true });
  const rows = await p.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="print-agent-row"]')).map((n) => ({
      liveness: n.getAttribute("data-agent-liveness"),
      text: (n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
    })),
  );
  console.log("connected:", JSON.stringify(rows.filter((r) => r.liveness === "CONNECTED")));
  console.log("total agents:", rows.length);
  const alerts = await p.evaluate(() =>
    Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)),
  );
  console.log("alerts:", JSON.stringify(alerts));
  await p.locator('[data-agent-liveness="CONNECTED"]').first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  await shot(p, "11-printers-final-connected");
} finally { await b.close(); }
