/* Cross-tenant probes for HR, executed from inside a real authenticated browser session. */
import { P, login, newPage, visit } from "./hrrt-lib.mjs";

const FT = {
  employee: "8f853257-f25b-4f59-b45c-32a98ec95f63", // Floating Terrace "1 TESt"
  run: "22b3eafd-a033-41ad-a96d-951ef6d6bd7e",      // FT PAID payroll run 8/2026
  branch: "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03",
  leave: "883d3c7c-4804-4b3a-b0cc-183844c78d48",
};
const FOREIGN_EMP = "7ff7a777-a6f6-4678-b576-20f897fdd5e6"; // tenant 11111111-…

const { browser, page } = await newPage();
try {
  await login(page, P.owner);
  await visit(page, "/app/hr/employees", { persona: P.owner });

  // Probe as the FLOATING TERRACE owner against a foreign employee.
  const probes = [
    ["GET", `/api/v1/hr/attendance/${FOREIGN_EMP}/summary?date=2026-08-11`],
    ["GET", `/api/v1/hr/attendance/${FOREIGN_EMP}/punches?date=2026-08-11`],
    ["POST", `/api/v1/hr/attendance/${FOREIGN_EMP}/clock-in`],
    ["GET", `/api/v1/hr/leave/balances?employeeId=${FOREIGN_EMP}`],
    ["GET", `/api/v1/hr/employees`],
    ["GET", `/api/v1/hr/leave/requests`],
    ["GET", `/api/v1/hr/config/tax`],
  ];
  const run = async (method, path) =>
    page.evaluate(async ([m, p]) => {
      try {
        const r = await fetch(`http://localhost:8080${p}`, {
          method: m, credentials: "include",
          headers: { "content-type": "application/json" },
        });
        const t = await r.text();
        return { status: r.status, body: t.slice(0, 380) };
      } catch (e) { return { status: -1, body: String(e) }; }
    }, [method, path]);

  console.log("### As Floating Terrace OWNER");
  for (const [m, p] of probes) {
    const r = await run(m, p);
    console.log(`  ${r.status} ${m} ${p}\n      ${r.body.replace(/\n/g, " ")}`);
  }

  // Now as CONTROL BISTRO owner, probe Floating Terrace's HR objects.
  const CTRL = { slug: "control-bistro-isolation-test-tenant", email: "owner@control.local", password: "Control#Owner1", totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ" };
  await page.context().clearCookies();
  await login(page, CTRL);
  await visit(page, "/app/hr/employees", { persona: CTRL, tries: 1 });
  console.log("\n### As CONTROL BISTRO owner — HR employees page shows:");
  console.log((await page.locator("main").innerText().catch(() => "(no main)")).slice(0, 600).replace(/\n{2,}/g, " | "));

  const probes2 = [
    ["GET", `/api/v1/hr/employees/${FT.employee}`],
    ["GET", `/api/v1/hr/attendance/${FT.employee}/summary?date=2026-08-11`],
    ["GET", `/api/v1/hr/attendance/${FT.employee}/punches?date=2026-08-11`],
    ["POST", `/api/v1/hr/attendance/${FT.employee}/clock-in`],
    ["GET", `/api/v1/hr/payroll-runs/${FT.run}/payslips`],
    ["POST", `/api/v1/hr/payroll-runs/${FT.run}/calculate`],
    ["GET", `/api/v1/hr/labour-cost/branch/${FT.branch}?month=8&year=2026`],
    ["POST", `/api/v1/hr/leave/requests/${FT.leave}/reject`],
    ["GET", `/api/v1/hr/leave/balances?employeeId=${FT.employee}`],
    ["GET", `/api/v1/hr/config/tax/2027`],
    ["GET", `/api/v1/hr/payroll-runs`],
  ];
  console.log("\n### CONTROL BISTRO owner reaching for FLOATING TERRACE objects");
  for (const [m, p] of probes2) {
    const r = await run(m, p);
    const leak = /Floating|TESt|8f853257|27000000|26742000|270000/.test(r.body);
    console.log(`  ${r.status} ${m} ${p}${leak ? "   <<< LEAK?" : ""}\n      ${r.body.replace(/\n/g, " ")}`);
  }
} catch (e) {
  console.log("FATAL", String(e).slice(0, 500));
} finally {
  await browser.close();
}
