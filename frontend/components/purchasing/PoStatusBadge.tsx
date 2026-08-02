// Sibling of `MatchStatusBadge` in ThreeWayMatchTable.tsx — same shape (a semantic-token badge
// keyed by a status string), one per PoStatus (backend enum, PoStatus.java).
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  APPROVED: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  SENT: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  FULLY_RECEIVED: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  CLOSED: "bg-muted text-muted-foreground",
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
  const cls = STATUS_COLOR[status] ?? "bg-muted text-muted-foreground";
  const label = STATUS_LABEL[status] ?? status;
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
