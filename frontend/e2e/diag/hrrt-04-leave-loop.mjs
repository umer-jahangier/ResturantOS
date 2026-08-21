import { P, login, newPage, shot, visit } from "./hrrt-lib.mjs";

const who = process.argv[2] ?? "owner";
const { browser, page } = await newPage();
const bodies = [];
page.on("response", async (r) => {
  if (!r.url().includes("/api/v1/hr/leave")) return;
  let t = "";
  try { t = (await r.text()).slice(0, 400); } catch {}
  bodies.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:8080", "")} :: ${t}`);
});
async function toasts() {
  return (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []))
    .map((s) => s.replace(/\n/g, " | ").trim());
}
try {
  await login(page, P[who]);
  await visit(page, "/app/hr/attendance", { persona: P[who] });
  const leave = page.locator("main section").nth(1);
  const sels = leave.locator("select");
  // A DIFFERENT employee, and dates well clear of the existing approved request.
  await sels.nth(0).selectOption({ index: 4 }); // Diag Cashier
  await sels.nth(1).selectOption({ index: 3 }); // Unpaid
  const dates = leave.locator('input[type="date"]');
  await dates.nth(0).fill("2026-09-14");
  await dates.nth(1).fill("2026-09-16");
  await page.waitForTimeout(400);
  await shot(page, `${who}-leave-00-form`);
  await leave.getByRole("button", { name: "Request leave" }).click();
  await page.waitForTimeout(3500);
  const t1 = await toasts();
  console.log("[request] toasts:", JSON.stringify(t1));
  await shot(page, `${who}-leave-01-requested`);

  const m = t1.join(" ").match(/\(([0-9a-f-]+)\)/i);
  const shown = m ? m[1] : null;
  console.log("[request] id the UI gives the user:", shown, "len", shown?.length);

  // Is there ANY list of leave requests, balances, or pending approvals on this page?
  const main = await page.locator("main").innerText();
  console.log("[list] page mentions the new request anywhere else?",
    shown && main.includes(shown) ? "yes (toast only)" : "no");
  console.log("[list] main body:\n" + main.replace(/\n{2,}/g, "\n"));

  // Approve using ONLY what the UI handed us.
  const box = leave.locator('input[placeholder="Leave request id"]');
  await box.fill(shown ?? "");
  await leave.getByRole("button", { name: "Approve", exact: true }).click();
  await page.waitForTimeout(3500);
  console.log("[approve with UI-shown id] toasts:", JSON.stringify(await toasts()));
  await shot(page, `${who}-leave-02-approve-shown`);

  const full = process.env.FULL_LEAVE_ID;
  if (full) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const leave2 = page.locator("main section").nth(1);
    await leave2.locator('input[placeholder="Leave request id"]').fill(full);
    await leave2.getByRole("button", { name: "Approve", exact: true }).click();
    await page.waitForTimeout(3500);
    console.log("[approve with DB uuid] toasts:", JSON.stringify(await toasts()));
    await shot(page, `${who}-leave-03-approve-full`);
  }
} catch (e) {
  console.log("FATAL", String(e).slice(0, 400));
  await shot(page, `${who}-leave-FATAL`);
} finally {
  console.log("\n[network]");
  for (const b of bodies) console.log("   " + b);
  await browser.close();
}
