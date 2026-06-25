import type { ReactNode } from "react";

// Public auth area (login, password reset, TOTP). No session required.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
