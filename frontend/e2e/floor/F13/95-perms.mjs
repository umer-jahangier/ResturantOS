/*
 * F13 re-open (independent, second attempt) — step 0.
 *
 * Who actually holds `pos.order.refund`? The fix picks the sentence from
 * `useCurrentUser().permissions.includes("pos.order.refund")`, and PermissionGuard renders the
 * button from the same array with the same `.includes`. That is only safe if NO persona's token
 * expresses the grant some other way (a wildcard, an uppercase code, a role-implied grant).
 * If one does, the guard shows the button and the copy says "a manager must" — the same defect,
 * mirrored.
 */
import { newBrowser, newPage, login, tokenOf, log } from "./lib.mjs";

const WHO = {
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
  owner: {
    slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  admin: {
    slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1",
    totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
};

const browser = await newBrowser();
const out = {};
for (const [name, who] of Object.entries(WHO)) {
  const page = await newPage(browser);
  try {
    await login(page, who);
    const tok = await tokenOf(page);
    const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
    const perms = claims.permissions ?? [];
    out[name] = {
      refund: perms.includes("pos.order.refund"),
      voidOwn: perms.includes("pos.order.void.own"),
      voidAny: perms.includes("pos.order.void.any"),
      close: perms.includes("pos.order.close"),
      wildcards: perms.filter((p) => p.includes("*")),
      refundLike: perms.filter((p) => /refund/i.test(p)),
      total: perms.length,
      roles: claims.roles,
    };
    log(name, JSON.stringify(out[name]));
  } catch (e) {
    out[name] = { error: String(e).slice(0, 200) };
    log(name, "ERROR", out[name].error);
  }
  await page.context().close();
}
await browser.close();
console.log("\nRESULT " + JSON.stringify(out, null, 2));
