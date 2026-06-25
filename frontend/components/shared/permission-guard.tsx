"use client";

import type { ReactNode } from "react";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

// Renders children only if the required permission(s) are present in the DECODED
// access-JWT claims (FE-06). Default fallback is `null` (hide). `mode="any"`
// requires at least one; `mode="all"` (default) requires every listed permission.
interface PermissionGuardProps {
  require: string | string[];
  mode?: "all" | "any";
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGuard({
  require,
  mode = "all",
  fallback = null,
  children,
}: PermissionGuardProps) {
  const { permissions } = useCurrentUser();
  const required = Array.isArray(require) ? require : [require];

  const granted =
    mode === "any"
      ? required.some((permission) => permissions.includes(permission))
      : required.every((permission) => permissions.includes(permission));

  return <>{granted ? children : fallback}</>;
}
