"use client";

import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useStations } from "@/lib/hooks/pos/use-station-admin";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { stationTypeLabel, stationTypeScreen } from "@/components/stations/station-type-select";

/**
 * Which stations this person works — the capability the user said was missing.
 *
 * <p>Their words: *"don't have the exact capacity to select the specific screen/station for that
 * account he is creating."* This is that control, and it sits directly below the role select so
 * the three decisions an admin makes about where a person works are in one place (D-28-02).
 *
 * <h3>Selecting nothing means EVERYTHING, and the field says so in words</h3>
 *
 * Every user in every tenant is unassigned today, and that is the correct state for a restaurant
 * with one kitchen screen. A field that rendered an empty selection as "none" — or worse, styled
 * it as a warning — would invite an admin to fix a problem that does not exist, and the fix would
 * narrow a working kitchen into a set of screens nobody is watching. So the summary sentence is
 * plain text, not an alert, and it states the consequence rather than the count.
 *
 * <h3>Why the picker only offers the branch you are signed in to</h3>
 *
 * `GET /api/v1/pos/stations` validates its `branchId` against the caller's own JWT branch
 * (`StationServiceImpl.requireOwnBranch`) and refuses anything else with 403. So a station list
 * for a branch the admin is not currently in cannot be fetched at all. Rather than render a
 * picker that 403s — which looks like a bug — the field says which branch it can offer and what
 * to do, and the assignment stays editable later from the same form.
 *
 * <h3>Why the change is not instant</h3>
 *
 * The scope rides `attributes.stations` on the access token, and auth-service's access tokens
 * live 900 seconds. A user already signed in keeps their current stations until their session
 * refreshes. Saying so is the difference between an admin trusting the save and doing it three
 * more times.
 */

/** `AuthJwtProperties.accessTtlSeconds` — 900. Stated in minutes because that is how it reads. */
const ACCESS_TOKEN_MINUTES = 15;

export function StationAssignmentField({
  branchId,
  branchLabel,
  value,
  onChange,
  disabled,
}: {
  /** The branch chosen in the form. The field is not rendered at all before one is chosen. */
  branchId: string;
  branchLabel: string;
  value: string[];
  onChange: (stationCodes: string[]) => void;
  disabled?: boolean;
}) {
  const { branchId: signedInBranchId } = useCurrentUser();
  const isSignedInBranch = branchId === signedInBranchId;
  const stations = useStations();

  const offered = isSignedInBranch ? (stations.data ?? []) : [];
  const selectedNames = offered.filter((s) => value.includes(s.code)).map((s) => s.name);

  function toggle(code: string) {
    const next = value.includes(code) ? value.filter((c) => c !== code) : [...value, code];
    // Sorted so the payload is stable regardless of click order — auth-service sorts on its side
    // too, and two representations of the same set is how a diff becomes noise.
    onChange([...next].sort());
  }

  return (
    <div data-testid="station-assignment-field" className="space-y-2">
      {!isSignedInBranch ? (
        <p
          data-testid="station-assignment-cross-branch"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-label text-muted-foreground"
        >
          Stations are listed for the branch you are signed in to. Switch to {branchLabel} to choose
          its stations — you can set them any time by editing this account.
        </p>
      ) : stations.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : stations.isError ? (
        // Never an empty picker. An empty list of checkboxes says "this branch has no stations",
        // which is a different fact from "we could not ask".
        <QueryErrorNotice
          what="this branch's stations"
          error={stations.error}
          onRetry={() => void stations.refetch()}
          isRetrying={stations.isFetching}
        />
      ) : offered.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-label text-muted-foreground">
          {branchLabel} has no stations yet. Add one on the Stations screen and it will appear here;
          until then everyone at this branch sees the whole board.
        </p>
      ) : (
        <>
          <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
            {offered.map((station) => (
              <li key={station.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-small hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="size-4 rounded-md border-input"
                    checked={value.includes(station.code)}
                    disabled={disabled}
                    onChange={() => toggle(station.code)}
                  />
                  <span className="min-w-0 flex-1 truncate">{station.name}</span>
                  <span className="shrink-0 text-label text-muted-foreground">
                    {stationTypeLabel(station.stationType)} —{" "}
                    {stationTypeScreen(station.stationType)}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <p data-testid="station-assignment-summary" className="text-label text-muted-foreground">
            {selectedNames.length === 0
              ? "They will see every station in this branch."
              : `They will see ${formatList(selectedNames)} only.`}
          </p>
        </>
      )}

      <p data-testid="station-assignment-delay-notice" className="text-label text-muted-foreground">
        If they are already signed in, the change reaches them when their session next refreshes —
        within {ACCESS_TOKEN_MINUTES} minutes, or straight away if they sign out and back in.
      </p>
    </div>
  );
}

function formatList(names: string[]): string {
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
