/* Cross-tenant HR probes carrying the session's REAL Authorization header. */
import { P, login, newPage, visit } from "./hrrt-lib.mjs";

const FT = {
  employee: "8f853257-f25b-4f59-b45c-32a98ec95f63",
  run: "22b3eafd-a033-41ad-a96d-951ef6d6bd7e",
  branch: "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03",
  leave: "883d3c7c-4804-4b3a-b0cc-183844c78d48",
  dept: null,
};
const { browser, page } = await newPage();
let authHeader = null;
page.on("request", (r) => {
  const h = r.headers();
  if (h.authorization && r.url().includes("/api/v1/")) authHeader = h.authorization;
});

async function probe(m, p) {
  return page.evaluate(async ([m, p, auth]) => {
    try {
      const r = await fetch(`http://localhost:8080${p}`, {
        method: m, credentials: "include",
        headers: { "content-type": "application/json", authorization: auth },
      });
      return { status: r.status, body: (await r.text()).slice(0, 400) };
    } catch (e) { return { status: -1, body: String(e) }; }
  }, [m, p, authHeader]);
}

try {
  const CTRL = { slug: "control-bistro-isolation-test-tenant", email: "owner@control.local", password: "Control#Owner1", totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ" };
  await login(page, CTRL);
  await visit(page, "/app/hr/employees", { persona: CTRL });
  await page.waitForTimeout(1500);
  console.log("auth header captured:", authHeader ? authHeader.slice(0, 25) + "…" : "NONE");
  if (authHeader) {
    const claims = JSON.parse(Buffer.from(authHeader.split(" ")[1].split(".")[1], "base64url").toString());
    console.log("token tenant:", claims.tenant_id ?? claims.tenantId, "| sub:", claims.sub, "| totp_verified:", claims.totp_verified);
  }

  const probes = [
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
    ["GET", `/api/v1/hr/shifts/week?weekStart=2026-08-10`],
  ];
  console.log("\n### CONTROL BISTRO owner reaching for FLOATING TERRACE HR objects");
  for (const [m, p] of probes) {
    const r = await probe(m, p);
    const leak = /TESt|8f853257|27000000|26742000|"basicPaisa"|Kitchen|616000|"employeeNo"/.test(r.body);
    console.log(`  ${r.status} ${m} ${p}${leak ? "   <<<<<< POSSIBLE LEAK" : ""}`);
    console.log(`        ${r.body.replace(/\n/g, " ")}`);
  }
} catch (e) {
  console.log("FATAL", String(e).slice(0, 500));
} finally {
  await browser.close();
}
