/*
 * F11 RE-OPEN — an independent attempt to break "a duty manager can open a till for a
 * NAMED cashier". Reuses the full-shift harness verbatim (real logins, real TOTP, every
 * out-of-band read on the persona's OWN bearer minted from their own refresh cookie).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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

export const OUT = resolve(process.cwd(), "../.planning/audits/floor/F11-reopen");
mkdirSync(OUT, { recursive: true });

const STATE = resolve(OUT, "_state.json");
export function loadState() {
  if (!existsSync(STATE)) return {};
  return JSON.parse(readFileSync(STATE, "utf8"));
}
export function saveState(patch) {
  const s = { ...loadState(), ...patch };
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  return s;
}

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`    shot: ${name}.png`);
  return p;
}

export function ok(cond, label, detail) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  return { pass: !!cond, label, detail: detail ?? null };
}
