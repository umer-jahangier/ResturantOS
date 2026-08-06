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

function looksLikeValidationDump(message: string): boolean {
  const trimmed = message.trim();
  return (
    trimmed.startsWith("[") ||
    trimmed.includes('"invalid_type"') ||
    trimmed.includes('"code":"invalid_type"')
  );
}

function sanitizeMessage(message: string): string {
  if (!message || looksLikeValidationDump(message)) {
    return UNKNOWN_ERROR_MSG;
  }
  if (message.length > 160) {
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
