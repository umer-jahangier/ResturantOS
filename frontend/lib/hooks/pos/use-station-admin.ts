"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PosRepository } from "@/lib/repositories/pos.repository";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { Station } from "@/lib/models/pos.model";
import type { CreateStationInput, UpdateStationInput } from "@/lib/api-client/schemas/pos.schema";
// Type-only import — permitted from lib/hooks/** (the layer rule covers components/** and
// app/** only); same justification as use-menu-admin.ts and use-table-admin.ts.
import type { ApiError } from "@/lib/api-client/errors";

/**
 * Station CATALOGUE hooks (28-06) — the first frontend caller `/api/v1/pos/stations` has ever
 * had. The backend CRUD has existed since phase 3 with nine integration tests and zero UI, which
 * meant creating a station required curl. D-28-05 refuses that: a bar station only a developer
 * can create is not a bar station a restaurant owner has.
 *
 * <h3>Why the keys are local rather than in `query-keys.ts`</h3>
 *
 * The shared registry is edited by every concurrent workstream at once and was dirty in this
 * working tree when this file was written; adding a namespace to it here would have swept another
 * agent's uncommitted lines into this plan's commit. The precedent is already in the tree —
 * `use-users.ts` keeps `userKeys` locally and records the same reason, as does `use-inventory.ts`.
 * Folding these in is a one-line migration whenever the registry is next open for another purpose.
 *
 * <p>The keys are branch-scoped: a station code is unique within a BRANCH, not within a tenant,
 * so a branch switch must not leave the previous branch's stations on screen.
 */
export const stationKeys = {
  all: (branchId: string) => ["pos", branchId, "stations"] as const,
  /**
   * The retired-inclusive listing gets its own key, and it is a CHILD of `all` so a write
   * invalidating the parent refreshes both. Sharing one entry would let the catalogue response
   * (retired rows included) be served to a picker that must only ever offer live stations.
   */
  catalogue: (branchId: string) => ["pos", branchId, "stations", "catalogue"] as const,
};

/**
 * The branch's ACTIVE stations — what a picker should offer.
 *
 * <p>The filtering is client-side because `GET /api/v1/pos/stations` has no `includeInactive`
 * parameter: unlike `/pos/tables`, it returns every row for the branch and always has. The plan
 * assumed the two endpoints were symmetric; they are not, and inventing a parameter the server
 * does not accept would have been silently ignored rather than refused. Recorded as a deviation
 * in this plan's summary.
 */
export function useStations() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: stationKeys.all(branchId),
    queryFn: () => PosRepository.getStations(branchId),
    enabled: isAuthenticated && !!branchId,
    select: (stations: Station[]) => stations.filter((s) => s.active),
  });
}

/**
 * Every station including retired ones — the catalogue view, where a retired station has to be
 * findable in order to be restored.
 */
export function useStationCatalogue() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: stationKeys.catalogue(branchId),
    queryFn: () => PosRepository.getStations(branchId),
    enabled: isAuthenticated && !!branchId,
  });
}

/**
 * Both listings are invalidated on every write. `["pos", branchId, "stations"]` is a prefix of
 * the catalogue key, so one call covers both: a newly created station has to appear in a picker
 * someone is looking at, and a retired one has to disappear from it.
 */
function invalidateStationQueries(qc: ReturnType<typeof useQueryClient>, branchId: string) {
  void qc.invalidateQueries({ queryKey: stationKeys.all(branchId) });
}

export function useCreateStation() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Station, ApiError, CreateStationInput>({
    mutationFn: (input) => PosRepository.createStation(branchId, input),
    onSuccess: () => invalidateStationQueries(qc, branchId),
  });
}

export function useUpdateStation() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Station, ApiError, { id: string; input: UpdateStationInput }>({
    mutationFn: ({ id, input }) => PosRepository.updateStation(id, branchId, input),
    onSuccess: () => invalidateStationQueries(qc, branchId),
  });
}

/**
 * Retire (`false`) or restore (`true`). There is no delete: a fired ticket names its station by
 * code and the KDS projection is keyed on it, so the row must survive.
 *
 * <p>Restore goes through `updateStation` because pos-service has no reactivate endpoint — the
 * `DELETE` verb is the only retire path and `PUT` with `active: true` is the only restore path.
 * Both spellings live behind this one hook so a caller does not have to know which is which.
 */
export function useSetStationActive() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<
    Station,
    ApiError,
    { id: string; active: boolean; name: string; stationType: Station["stationType"] }
  >({
    mutationFn: ({ id, active, name, stationType }) =>
      active
        ? PosRepository.updateStation(id, branchId, { name, active: true, stationType })
        : PosRepository.retireStation(id, branchId),
    onSuccess: () => invalidateStationQueries(qc, branchId),
  });
}
