/* Can an owner actually enter their restaurant's address / phone / timezone and have it stick? */
import { launch, visit, OUT, BASE } from "./onboarding-lib.mjs";
import { createHmac } from "node:crypto";

const SLUG = "diag-bistro-953661";
const EMAIL = "owner@diag-bistro-953661.local";
const PW = "Diag#Owner1!";
const SECRET = "YE7TXDXIDDVFBJAIGOWDMLU725ZKAELN";

function b32(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/[^A-Za-z2-7]/g,"").toUpperCase()){const x=a.indexOf(c);if(x<0)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&255);b-=8;}}return Buffer.from(o);}
function totp(s){const c=Math.floor(Date.now()/1000/30);const bf=Buffer.alloc(8);bf.writeUInt32BE(Math.floor(c/2**32),0);bf.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",b32(s)).update(bf).digest();const o=h[h.length-1]&15;const code=((h[o]&127)<<24)|((h[o+1]&255)<<16)|((h[o+2]&255)<<8)|(h[o+3]&255);return String(code%1e6).padStart(6,"0");}

const { browser, page } = await launch();
page.on("response", async (r) => {
  if (r.url().includes("/api/v1/branches") && r.request().method() === "PUT") {
    let b = ""; try { b = (await r.text()).slice(0, 400); } catch {}
    console.log(`   PUT branches -> ${r.status()} ${b}`);
  }
});
try {
  await page.goto(`${BASE}/login?tenant=${SLUG}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.locator("input#email, input[name=email]").first().fill(EMAIL);
  await page.locator("input#password, input[name=password]").first().fill(PW);
  const tf = page.locator('input[name="totpCode"], input#totpCode');
  if (await tf.count()) await tf.first().fill(totp(SECRET));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) {
    const t2 = page.locator('input[name="totpCode"], input#totpCode');
    if (await t2.count()) { await t2.first().fill(totp(SECRET)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(7000); }
  }
  console.log("LANDED:", page.url());
  const s = await visit(page, "/app/settings", "sv-01-settings", { chars: 300 });
  if (/Sign in to RestaurantOS/.test(s.text)) throw new Error("session died");

  await page.locator('input[name="address"]').fill("14 Jinnah Boulevard, F-7 Markaz, Islamabad");
  await page.locator('input[name="phone"]').fill("+92-51-2345678");
  await page.screenshot({ path: `${OUT}/sv-02-filled.png`, fullPage: true });
  const save = page.getByRole("button", { name: /save/i });
  console.log("save buttons:", await save.count());
  await save.first().click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/sv-03-after-save.png`, fullPage: true });
  console.log("AFTER SAVE:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(-700));

  // reload and read back
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const addr = await page.locator('input[name="address"]').inputValue();
  const phone = await page.locator('input[name="phone"]').inputValue();
  console.log("READBACK address:", JSON.stringify(addr));
  console.log("READBACK phone:", JSON.stringify(phone));
  await page.screenshot({ path: `${OUT}/sv-04-readback.png`, fullPage: true });
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/sv-FAIL.png`, fullPage: true });
} finally {
  await browser.close();
}
