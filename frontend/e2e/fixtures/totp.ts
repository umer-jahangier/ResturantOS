import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * RFC-6238 TOTP, stdlib only — the Node twin of `totp_now()` in
 * `scripts/seed_restaurantos.py` (SHA-1, 30s step, 6 digits, dynamic truncation).
 *
 * Kept dependency-free for the same reason the seed script is: T-13-15-SC forbids
 * installing a package to make a verification path run, and a second TOTP
 * implementation with different defaults is a source of false failures.
 */

const SEED_STATE_DIR = process.env.SEED_STATE_DIR ?? join(process.cwd(), "..", ".seed-state");
const TOTP_DIR = join(SEED_STATE_DIR, "totp");

function base32Decode(input: string): Buffer {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The current 6-digit code. `skew` shifts by whole 30s windows (-1 = previous). */
export function totpNow(secret: string, skew = 0): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30_000) + skew;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const truncated = mac.readUInt32BE(offset) & 0x7fffffff;
  return (truncated % 1_000_000).toString().padStart(6, "0");
}

/**
 * The enrolled secret for a persona, as written by the seed script.
 *
 * The secret is minted by auth-service at `/2fa/bootstrap` and is NOT derivable — if
 * `.seed-state/totp/` is lost, the only recovery is re-enrolment (`seed_restaurantos.py
 * --repair`). Returns null rather than throwing so a caller can decide whether the
 * absence is fatal for *this* persona.
 *
 * Path/permissions mirror `totp_secret_path()` in scripts/seed_restaurantos.py:113-117,401-412.
 */
export function loadTotpSecret(email: string): string | null {
  const file = join(TOTP_DIR, email.replace(/[^A-Za-z0-9._@-]/g, "_"));
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Where secrets are expected — quoted verbatim in failure messages so the fix is obvious. */
export const TOTP_SECRET_DIR = TOTP_DIR;

/**
 * A code that is guaranteed not to be consumed mid-window.
 *
 * auth-service accepts the current window (and, per `login()` in the seed script, tolerates
 * the previous one on retry). Submitting a code that expires between typing and POSTing is
 * the classic flaky-TOTP failure; if fewer than `minRemainingMs` are left in the window we
 * wait for the next one rather than gamble.
 */
export async function totpStable(secret: string, minRemainingMs = 3_000): Promise<string> {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < minRemainingMs) {
    await new Promise((r) => setTimeout(r, remaining + 250));
  }
  return totpNow(secret);
}
