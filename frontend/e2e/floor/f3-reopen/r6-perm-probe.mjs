/*
 * What does the waiter's own token actually carry? r5 read `/api/v1/auth/me`, which does not
 * exist (404) and therefore yielded an empty permission list — a probe defect, not a product
 * one. Permissions travel IN the JWT here, so read them from the token itself.
 */
import { newBrowser, newPage, tokenOf } from "../../shift/lib.mjs";
import { loginPatiently as login } from "./rlib.mjs";

const b = await newBrowser();
for (const who of [
  { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
  { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" },
  { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
]) {
  const p = await newPage(b);
  await login(p, who);
  const tok = await tokenOf(p);
  const payload = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString());
  const perms = payload.permissions ?? payload.perms ?? payload.authorities ?? [];
  const kds = (Array.isArray(perms) ? perms : String(perms).split(/[ ,]/)).filter((x) =>
    String(x).includes("kds"),
  );
  console.log(`${who.email.padEnd(26)} kds permissions: ${JSON.stringify(kds)}`);
  await p.close();
}
await b.close();
