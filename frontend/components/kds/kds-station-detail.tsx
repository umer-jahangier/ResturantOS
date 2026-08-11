"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { KdsTicketDetail } from "@/components/kds/kds-ticket-detail";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { T_SMALL } from "@/components/kds/kds-type";
import { cn } from "@/lib/utils";

interface KdsStationDetailProps {
  branchId: string;
  stationCode: string;
  ticketId: string;
}

/**
 * Dedicated KDS ticket detail PAGE (KDS-04/D-12) — kills the pre-07.3-10
 * tap-to-open Dialog (`kds-ticket-card.tsx` no longer has one). URL:
 * `kitchen/[stationCode]/orders/[ticketId]`. Always-dark, same as the board
 * (07-04-D). Reuses KdsTicketDetail for the revision-grouped item list + Kitchen
 * Notes callout, adding per-item transition controls for canUpdate principals.
 */
export function KdsStationDetail({ branchId, stationCode, ticketId }: KdsStationDetailProps) {
  const { permissions } = useCurrentUser();
  const canUpdate = permissions.includes("pos.kds.update");

  return (
    <div
      data-surface="kds"
      className="min-h-screen bg-kds-surface p-4 text-kds-text"
      data-testid="kds-station-detail"
    >
      <Link
        href={`/app/kitchen/${stationCode}`}
        className={cn(
          "mb-4 inline-flex items-center gap-1 text-kds-muted hover:text-kds-text",
          T_SMALL,
        )}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to board
      </Link>
      <div className="mx-auto max-w-2xl rounded-xl border border-white/10 bg-kds-card p-4">
        <KdsTicketDetail ticketId={ticketId} branchId={branchId} canUpdate={canUpdate} />
      </div>
    </div>
  );
}
