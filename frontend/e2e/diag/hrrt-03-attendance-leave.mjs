import { P, login, newPage, shot, visit, watch } from "./hrrt-lib.mjs";

const who = process.argv[2] ?? "owner";
const { browser, page } = await newPage();

async function toasts() {
  const t = await page.locator("[data-sonner-toast], li[data-sonner-toast]").allInnerTexts().catch(() => []);
  return t.map((s) => s.replace(/\n/g, " | ").trim());
}

try {
  await login(page, P[who]);
  const w = watch(page, "/api/v1/hr/");
  await visit(page, "/app/hr/attendance", { persona: P[who] });

  const sections = page.locator("main section");
  // ---------- 1. CLOCK IN / OUT ----------
  const empSelect = sections.nth(0).locator("select");
  const opts = await empSelect.locator("option").allInnerTexts();
  console.log("\n[clock] employee options:", JSON.stringify(opts));
  await empSelect.selectOption({ index: 1 });
  await page.waitForTimeout(2500);
  console.log("[clock] summary line after select:", (await sections.nth(0).innerText()).replace(/\n/g, " | "));

  await page.getByRole("button", { name: "Clock in", exact: true }).click();
  await page.waitForTimeout(3000);
  console.log("[clock] toasts after Clock in:", JSON.stringify(await toasts()));
  console.log("[clock] section 0 now:", (await sections.nth(0).innerText()).replace(/\n/g, " | "));
  await shot(page, `${who}-att-01-clockin`);

  await page.getByRole("button", { name: "Clock out", exact: true }).click();
  await page.waitForTimeout(3000);
  console.log("[clock] toasts after Clock out:", JSON.stringify(await toasts()));
  console.log("[clock] section 0 now:", (await sections.nth(0).innerText()).replace(/\n/g, " | "));
  await shot(page, `${who}-att-02-clockout`);

  // ---------- 2. LEAVE REQUEST ----------
  const leave = sections.nth(1);
  const sels = leave.locator("select");
  await sels.nth(0).selectOption({ index: 1 });
  await sels.nth(1).selectOption({ index: 1 });
  await page.waitForTimeout(500);
  await leave.getByRole("button", { name: "Request leave" }).click();
  await page.waitForTimeout(3000);
  const reqToasts = await toasts();
  console.log("\n[leave] toasts after Request leave:", JSON.stringify(reqToasts));
  await shot(page, `${who}-att-03-leave-requested`);

  // What identifier does the UI hand the user?
  const m = reqToasts.join(" ").match(/\(([0-9a-f-]{4,})\)/i);
  const shownId = m ? m[1] : null;
  console.log("[leave] identifier shown to the user:", shownId, `(length ${shownId?.length})`);

  // ---------- 3. IS THERE ANY LIST OF PENDING LEAVE REQUESTS? ----------
  const mainText = await page.locator("main").innerText();
  console.log("\n[leave] does the page list any pending request?",
    /pending|requested/i.test(mainText) ? "maybe — see body" : "NO — no pending list anywhere");

  // ---------- 4. TRY TO APPROVE USING ONLY WHAT THE UI GAVE US ----------
  const approveBox = leave.locator('input[placeholder="Leave request id"]');
  if (await approveBox.count()) {
    await approveBox.fill(shownId ?? "");
    await leave.getByRole("button", { name: "Approve", exact: true }).click();
    await page.waitForTimeout(3000);
    console.log("[leave] toasts after Approve with the UI-shown id:", JSON.stringify(await toasts()));
    await shot(page, `${who}-att-04-approve-with-shown-id`);
  } else {
    console.log("[leave] NO approve control visible for", who);
  }

  // ---------- 5. APPROVE WITH THE FULL UUID (only obtainable from the database) ----------
  const full = process.env.FULL_LEAVE_ID;
  if (full && (await approveBox.count())) {
    await approveBox.fill(full);
    await leave.getByRole("button", { name: "Approve", exact: true }).click();
    await page.waitForTimeout(3000);
    console.log("[leave] toasts after Approve with the DB-sourced full uuid:", JSON.stringify(await toasts()));
    await shot(page, `${who}-att-05-approve-full-uuid`);
  }

  w.stop();
  console.log("\n[network] hr api calls:");
  for (const h of w.hits) console.log(`   ${h.status} ${h.method} ${h.url.replace("http://localhost:3000", "")}`);
} catch (e) {
  console.log("FATAL", e);
  await shot(page, `${who}-att-FATAL`);
} finally {
  await browser.close();
}
