"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { KdsTicketDetail } from "@/components/kds/kds-ticket-detail";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

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
    <div className="dark bg-gray-950 min-h-screen p-4" data-testid="kds-station-detail">
      <Link
        href={`/app/kitchen/${stationCode}`}
        className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-200 text-sm mb-4"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to board
      </Link>
      <div className="max-w-2xl mx-auto rounded-xl border border-gray-800 bg-gray-950 p-4">
        <KdsTicketDetail ticketId={ticketId} branchId={branchId} canUpdate={canUpdate} />
      </div>
    </div>
  );
}
