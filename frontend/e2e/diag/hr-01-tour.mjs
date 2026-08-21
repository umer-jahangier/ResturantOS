/* Pass 1: reach every HR screen as OWNER and record what is actually on it. */
import { newBrowser, ctxPage, login, visit, shot, PERSONAS } from "./hr-lib.mjs";

const ROUTES = [
  ["hr-root", "/app/hr"],
  ["employees", "/app/hr/employees"],
  ["payroll", "/app/hr/payroll"],
  ["schedule", "/app/hr/schedule"],
  ["attendance", "/app/hr/attendance"],
  ["settings-departments", "/app/hr/settings/departments"],
  ["settings-designations", "/app/hr/settings/designations"],
  ["settings-tax", "/app/hr/settings/tax"],
  // routes a competitor would have and this may not
  ["hr-devices", "/app/hr/devices"],
  ["hr-leave", "/app/hr/leave"],
  ["hr-documents", "/app/hr/documents"],
  ["hr-reports", "/app/hr/reports"],
];

const browser = await newBrowser();
const { page } = await ctxPage(browser);
await login(page, PERSONAS.owner);
console.log("signed in as owner, url:", page.url());

for (const [name, route] of ROUTES) {
  const r = await visit(page, route);
  console.log(`\n=== ${name}  ${route}  (final url ${page.url()})`);
  console.log(`  denied=${r.denied} failed=${r.failed} alerts=${JSON.stringify(r.alerts)}`);
  console.log("  ---- body ----");
  console.log(r.body.split("\n").map((l) => "  | " + l).join("\n").slice(0, 4000));
  await shot(page, `01-${name}`);
}

await browser.close();
