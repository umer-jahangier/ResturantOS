import { create } from "zustand";
import type { Session } from "@/lib/models/auth.model";

// In-memory session. The access token is held in memory ONLY (never localStorage)
// — on a full reload it is gone and the client bootstrap calls refreshSession()
// using the HttpOnly `refresh_token` cookie. setSession also writes a broadly
// scoped, non-HttpOnly `has_session` marker that proxy.ts/the DAL can read.

// Marker lifetime tracks the refresh-token TTL (UX hint only — forgeable, never
// a security boundary).
const HAS_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function writeSessionMarker(): void {
  if (typeof document === "undefined") return;
  document.cookie = `has_session=1; Path=/; SameSite=Strict; Max-Age=${HAS_SESSION_MAX_AGE_SECONDS}`;
}

function clearSessionMarker(): void {
  if (typeof document === "undefined") return;
  document.cookie = "has_session=; Path=/; SameSite=Strict; Max-Age=0";
}

interface SessionState {
  session: Session | null;
  setSession: (session: Session) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  setSession: (session) => {
    writeSessionMarker();
    set({ session });
  },
  clearSession: () => {
    clearSessionMarker();
    set({ session: null });
  },
}));

/** Synchronous read of the current session (used by the axios request interceptor). */
export function getSession(): Session | null {
  return useSessionStore.getState().session;
}

/**
 * Refresh the access token via the HttpOnly `refresh_token` cookie. Updates the
 * store + marker on success; clears them on failure. Returns whether it worked.
 * The repository is imported dynamically to avoid a static import cycle
 * (client → session → repository → request → client).
 */
export async function refreshSession(): Promise<boolean> {
  try {
    const { SessionRepository } = await import("@/lib/repositories/session.repository");
    const session = await SessionRepository.refresh();
    useSessionStore.getState().setSession(session);
    return true;
  } catch {
    useSessionStore.getState().clearSession();
    return false;
  }
}
