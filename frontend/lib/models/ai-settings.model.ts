/**
 * A tenant's AI provider and credential state (Program C).
 *
 * There is no key on this model, and there is nowhere for one to come from: the server's response
 * has no key field. The screen renders a four-character hint and a state, and offers to REPLACE —
 * never to reveal.
 */
export interface AiSettings {
  provider: "ANTHROPIC";
  /** Whose key is actually being used for this restaurant's questions — and therefore billed. */
  source: "TENANT" | "PLATFORM";
  /** Last four characters of the stored key. Null when the platform key is in use. */
  keyLast4: string | null;
  keyState: AiKeyState;
  lastVerifiedAt: string | null;
  lastRejectedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** False renders the screen read-only rather than refusing the page. */
  canManage: boolean;
  /** False means the server cannot store a key at all — an operator problem, not a user error. */
  storageAvailable: boolean;
}

export type AiKeyState = "UNSET" | "UNVERIFIED" | "VERIFIED" | "REJECTED";

/** The masked hint, written one way so the form and any future summary cannot drift apart. */
export function formatKeyHint(keyLast4: string | null): string {
  return keyLast4 ? `•••• ${keyLast4}` : "";
}

/**
 * The four screen states, as one function.
 *
 * UNVERIFIED is deliberately NOT rendered as a failure. It means the provider was unreachable when
 * the key was saved — an outage, not a bad key — and the first successful question promotes it on
 * its own. Showing a red banner there would send an owner to re-enter a key that is probably fine.
 */
export function describeAiKeyState(settings: AiSettings): {
  tone: "neutral" | "success" | "warning" | "danger";
  title: string;
  detail: string;
} {
  if (settings.source === "PLATFORM") {
    return {
      tone: "neutral",
      title: "Using the built-in AI key",
      detail:
        "Questions are answered using the platform's AI account. Add your own API key below to bill AI usage to your own account instead.",
    };
  }
  switch (settings.keyState) {
    case "VERIFIED":
      return {
        tone: "success",
        title: "Your own API key is in use",
        detail: "The AI provider accepted this key. Questions bill to your account.",
      };
    case "UNVERIFIED":
      return {
        tone: "warning",
        title: "Saved, but not yet verified",
        detail:
          "We could not reach the AI provider when this key was saved, so we have not confirmed it works. It will be confirmed automatically the first time it answers a question.",
      };
    case "REJECTED":
      return {
        tone: "danger",
        title: "The AI provider refused this key",
        detail:
          "Questions are failing. The key may have been revoked or rotated at the provider. Replace it below.",
      };
    default:
      return {
        tone: "neutral",
        title: "No API key set",
        detail: "Add your own API key to bill AI usage to your own account.",
      };
  }
}
