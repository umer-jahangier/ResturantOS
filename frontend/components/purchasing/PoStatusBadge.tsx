// Sibling of `MatchStatusBadge` in ThreeWayMatchTable.tsx — same shape (a semantic-token badge
// keyed by a status string), one per PoStatus (backend enum, PoStatus.java).
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  REJECTED: "bg-red-100 text-red-800",
  SENT: "bg-indigo-100 text-indigo-800",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-800",
  FULLY_RECEIVED: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-200 text-gray-700",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SENT: "Sent",
  PARTIALLY_RECEIVED: "Partially received",
  FULLY_RECEIVED: "Fully received",
  CLOSED: "Closed",
};

export function PoStatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLOR[status] ?? "bg-gray-100 text-gray-800";
  const label = STATUS_LABEL[status] ?? status;
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
