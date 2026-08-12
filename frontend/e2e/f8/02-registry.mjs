/* Step 2 — read the live branch printer registry and the stations, as owner. */
import { newBrowser, newPage, login, PEOPLE, apiGet } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  const me = await apiGet(page, "/api/v1/auth/me");
  console.log("me:", JSON.stringify(me.body).slice(0, 1200));

  const branches = await apiGet(page, "/api/v1/branches");
  console.log("branches:", JSON.stringify(branches.body).slice(0, 3000));
} finally {
  await browser.close();
}
