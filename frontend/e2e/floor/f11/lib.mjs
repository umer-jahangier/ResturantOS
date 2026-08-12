/*
 * F11 — "a manager cannot open a till for anyone but themselves".
 *
 * Reuses the full-shift harness verbatim (real logins, TOTP, persona-own bearers, never a
 * token injection) and only re-points the screenshot directory at .planning/audits/floor/F11.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export {
  BASE,
  API,
  PEOPLE,
  newBrowser,
  newPage,
  login,
  totpNow,
  pageTrouble,
  go,
  money,
  tokenOf,
  apiGet,
  apiSend,
  log,
} from "../../shift/lib.mjs";

export const OUT = resolve(process.cwd(), "../.planning/audits/floor/F11");
mkdirSync(OUT, { recursive: true });

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`    shot: ${name}.png`);
  return p;
}
