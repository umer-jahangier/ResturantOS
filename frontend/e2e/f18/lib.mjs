/*
 * F18 — expo / pass view. Shared harness.
 *
 * Re-uses the full-shift harness verbatim (login incl. TOTP, trouble detection, the
 * refresh-cookie bearer mint) and only redirects the screenshot destination, so every
 * probe here is on exactly the same footing as the walkthrough it is answering.
 */
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

export {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  pageTrouble,
  go,
  money,
  tokenOf,
  apiGet,
  apiSend,
  log,
  totpNow,
} from "../shift/lib.mjs";

export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/floor/F18");
mkdirSync(OUT, { recursive: true });

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`    shot: ${name}.png`);
  return p;
}
