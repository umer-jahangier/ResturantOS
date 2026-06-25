"use client";

import { useMemo } from "react";

import { useSessionStore } from "@/lib/auth/session";
import { decodeJwt } from "@/lib/auth/jwt";
import type { DecodedClaims } from "@/lib/models/auth.model";

// Layer-3 hook: derives the current user's permissions/roles/branch from the
// in-memory access JWT (no `/me` call — claims come from decodeJwt). Components
// consume this for guards instead of touching the session store directly.
export interface CurrentUser {
  isAuthenticated: boolean;
  userId: string;
  branchId: string;
  roles: string[];
  permissions: string[];
  attributes: Record<string, unknown>;
}

const ANONYMOUS: CurrentUser = {
  isAuthenticated: false,
  userId: "",
  branchId: "",
  roles: [],
  permissions: [],
  attributes: {},
};

export function useCurrentUser(): CurrentUser {
  const session = useSessionStore((state) => state.session);

  return useMemo<CurrentUser>(() => {
    if (!session) {
      return ANONYMOUS;
    }

    let claims: DecodedClaims;
    try {
      claims = decodeJwt(session.accessToken);
    } catch {
      // A malformed token means no usable claims — treat as unauthenticated.
      return ANONYMOUS;
    }

    return {
      isAuthenticated: true,
      userId: claims.sub || session.userId,
      branchId: claims.branchId || session.branchId,
      roles: claims.roles,
      permissions: claims.permissions,
      attributes: claims.attributes,
    };
  }, [session]);
}
