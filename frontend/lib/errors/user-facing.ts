import { ZodError } from "zod";
import { ApiError } from "./api-error";

// Presentation mapping for thrown values: turns anything a repository/hook can reject
// with into one short, user-safe sentence. Deliberately transport-free so components
// may import it directly without crossing the FE-08 layer boundary.

const UNKNOWN_ERROR_MSG = "Something went wrong. Please try again.";

const USER_FACING_BY_CODE: Record<string, string> = {
  JE_UNBALANCED: "Journal entry lines must balance (total debit must equal total credit).",
  PERIOD_LOCKED: "This accounting period is locked. Posting is not allowed.",
  JE_ALREADY_POSTED: "This journal entry has already been posted.",
  PERIOD_ALREADY_LOCKED: "This period is already closed.",
  PERIOD_PRE_CHECK_FAILED: "Period cannot be closed yet. Resolve open items first.",
  INVALID_OPERATION: "This action is not allowed in the current state.",
  PERMISSION_DENIED: "You don't have permission to perform this action.",
  UNAUTHENTICATED: "Please sign in again.",
  TOTP_REQUIRED: "A verification code is required for this action.",
  VALIDATION_FAILED: "Please check your input and try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
  NETWORK_ERROR: "Unable to reach the server. Check your connection and try again.",
  UNKNOWN_ERROR: "Something went wrong. Please try again.",
  // Gateway fallback (FallbackController) — module-agnostic since this map is keyed by code
  // only; screens that know their module (e.g. inventory) override locally with the
  // Copywriting Contract's module-specific wording. Fixes the carried-over 08.2-CONTEXT.md gap
  // where users saw raw gateway text with no indication of which module was down.
  SERVICE_UNAVAILABLE: "This module is temporarily unavailable. Try again in a moment.",
};

/**
 * Schema-shaped machine output — a Zod issue list, or something carrying its field names.
 *
 * Narrower than {@link looksLikeMachineDump} on purpose: this one specifically means "the server's
 * response did not match what we expected to parse", which is a different thing to tell a user
 * than a generic failure, so it keeps its own message at the call sites below.
 */
function looksLikeValidationDump(message: string): boolean {
  const trimmed = message.trim();
  return (
    trimmed.startsWith("[") ||
    trimmed.includes('"invalid_type"') ||
    // Two co-occurring Zod issue keys. Either alone could plausibly appear in prose; the pair
    // could not, and this catches issue shapes other than `invalid_type` (`too_small`,
    // `unrecognized_keys`, …) that the literal above misses.
    (trimmed.includes('"path"') && trimmed.includes('"code"'))
  );
}

/**
 * Whether a string is machine output rather than a sentence someone wrote for a reader.
 *
 * <h3>Why this replaced a length cap</h3>
 *
 * This function used to be a single `message.length > 160` test, and length turned out to be the
 * wrong question. It is a proxy for "is this a dump", and it is a bad one in the specific direction
 * that matters: dumps are long, but so is a refusal that takes the trouble to name the offending
 * value AND say what to do about it. The cap therefore punished exactly the messages worth showing.
 * A fleet audit at the time this was written found eight refusals over the cap — every one of them
 * rendering on screen as "Something went wrong. Please try again." — including a payslip refusal
 * that carried the full arithmetic breakdown an operator needs to find the wrong number (306
 * chars), and a goods-receipt refusal that spends 72 of its characters on two raw UUIDs (400).
 * The failure was inverted: the more a backend explained, the less the user saw.
 *
 * <p>So the test is structural instead. Every branch below keys on something a written sentence
 * does not do, rather than on how much a sentence says.
 */
function looksLikeMachineDump(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  // A serialised structure: JSON array, JSON object, or an HTML/XML document (a proxy's 502 page).
  // No refusal written for a person opens with a bracket.
  if (/^[[{<]/.test(trimmed)) {
    return true;
  }
  if (looksLikeValidationDump(trimmed)) {
    return true;
  }
  // Stack frames — V8's "\n    at fn (file:1:2)" and the JVM's "\n\tat pkg.Class.method".
  if (/\n\s*at\s+\S/.test(trimmed)) {
    return true;
  }
  // A source position, with or without surviving frame syntax.
  if (/\.(?:[jt]sx?|mjs|cjs|java|kt):\d+/.test(trimmed)) {
    return true;
  }
  // Prose refusals across the fleet are built by concatenation and are single-line; three or more
  // breaks is a dump that none of the shape tests above happened to recognise.
  if ((trimmed.match(/\n/g)?.length ?? 0) >= 3) {
    return true;
  }
  return false;
}

/**
 * The residual length backstop, well clear of real copy.
 *
 * <p>Not the discriminator — {@link looksLikeMachineDump} is. This only catches a machine string
 * whose shape none of those tests recognised, on the reasoning that past this length it is far more
 * likely to be one of those than a sentence. The longest genuine message in the fleet when this was
 * set measured 400 characters, so this leaves roughly half again in headroom.
 *
 * <p>Deliberately NOT a truncation point. Across the fleet the remedy is the LAST clause —
 * "…Choose an ingredient that exists", "…repeat the request with force=true", "…it must be one of:
 * KG, G, L" — so cutting a long message to fit would reliably discard the only part worth reading.
 */
const MAX_USER_FACING_LENGTH = 600;

function sanitizeMessage(message: string): string {
  if (!message.trim() || looksLikeMachineDump(message)) {
    return UNKNOWN_ERROR_MSG;
  }
  if (message.length > MAX_USER_FACING_LENGTH) {
    return UNKNOWN_ERROR_MSG;
  }
  return message;
}

/** Map any thrown value to a short, user-safe message (never raw Zod/JSON dumps). */
export function formatUserFacingError(error: unknown): string {
  if (error instanceof ApiError) {
    return USER_FACING_BY_CODE[error.code] ?? sanitizeMessage(error.message);
  }
  if (error instanceof ZodError) {
    return "We couldn't read the server response. Please refresh and try again.";
  }
  if (error instanceof Error) {
    if (looksLikeValidationDump(error.message)) {
      return "We couldn't read the server response. Please refresh and try again.";
    }
    return sanitizeMessage(error.message);
  }
  return UNKNOWN_ERROR_MSG;
}
