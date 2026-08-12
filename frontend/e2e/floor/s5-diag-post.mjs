/* Why does POST /api/v1/branches answer 400 from the browser but 201 from curl? Measure it. */
import { newBrowser, newPage, login, PEOPLE, go } from "../shift/lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);

const wire = [];
page.on("request", (req) => {
  if (req.url().includes("localhost:8080")) {
    wire.push({
      dir: ">",
      m: req.method(),
      u: req.url().replace("http://localhost:8080", ""),
      ct: req.headers()["content-type"],
      body: (req.postData() || "").slice(0, 200),
      headers: req.headers(),
    });
  }
});
page.on("response", async (res) => {
  if (res.url().includes("localhost:8080")) {
    wire.push({
      dir: "<",
      s: res.status(),
      u: res.url().replace("http://localhost:8080", ""),
      body: res.status() >= 400 ? (await res.text().catch(() => "")).slice(0, 200) : "",
    });
  }
});

for (let i = 1; ; i++) {
  try {
    await login(page, PEOPLE.owner);
    break;
  } catch (e) {
    if (i >= 4) throw e;
    await page.waitForTimeout(20000);
  }
}
await go(page, "/app/branches", { waitMs: 4000 });
wire.length = 0;

await page.getByTestId("add-branch").click();
await page.waitForTimeout(600);
await page.getByTestId("branch-name-input").fill("Diag Branch " + String(Date.now()).slice(-5));
await page.getByTestId("branch-address-input").fill("1 Diagnostic Road");
await page.getByTestId("branch-form-submit").click();
await page.waitForTimeout(4000);

for (const w of wire.filter((w) => /branches|auth/.test(w.u))) console.log(JSON.stringify(w));
await browser.close();
