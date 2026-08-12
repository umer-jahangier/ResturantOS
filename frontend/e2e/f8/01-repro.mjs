/* Step 1 — reproduce the finding. Owner opens Settings → Printers. */
import { newBrowser, newPage, login, go, shot, PEOPLE, apiGet } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);

  const t = await go(page, "/app/settings/printers", { waitMs: 5000, allowTrouble: true });
  console.log("trouble:", JSON.stringify(t, null, 2));
  await shot(page, "01-printers-before");

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="print-agent-row"]')).map((n) => ({
      liveness: n.getAttribute("data-agent-liveness"),
      text: (n.textContent || "").trim().replace(/\s+/g, " "),
    })),
  );
  console.log("agent rows:", JSON.stringify(rows, null, 2));

  const body = await page.evaluate(() => document.body.innerText);
  console.log("---- PAGE TEXT ----");
  console.log(body);
  console.log("---- END ----");

  const me = await apiGet(page, "/api/v1/auth/me");
  console.log("branchId:", JSON.stringify(me.body?.data?.branchId ?? me.body?.branchId));
} finally {
  await browser.close();
}
