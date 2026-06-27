"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";

interface AccessDeniedProps {
  title?: string;
  description?: string;
}

export function AccessDenied({
  title = "Access denied",
  description = "You do not have permission to view this page.",
}: AccessDeniedProps) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <ShieldAlert className="size-12 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      <Link
        href="/app/dashboard"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
