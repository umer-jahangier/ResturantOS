"use client";

import { useQuery } from "@tanstack/react-query";
import { OpsRepository } from "@/lib/repositories/ops.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * How often the health screen re-reads the gateway's last sweep.
 *
 * <p>Five seconds. The gateway probes on its own five-second loop, so the screen is never more
 * than about ten seconds behind reality — and, critically, it refreshes WITHOUT a page reload. The
 * acceptance test for S1-09 is that an operator watching this screen sees a service they have just
 * restarted turn green on its own; a screen that needs F5 to tell you the outage is over is a
 * screen nobody will trust the next time.
 */
const POLL_MS = 5_000;

/**
 * The fleet, as the gateway last measured it (S1-09).
 *
 * <p>`refetchIntervalInBackground` is deliberately left off: an operator who has tabbed away is
 * not watching, and TanStack resumes on focus, which is the moment they look again.
 *
 * <p>`retry: false` — the whole subject of this query is failure. A silent three-attempt retry
 * ladder would delay the one screen whose job is to say "something is not answering" by several
 * seconds, and the retry the operator wants is the visible one on the error notice.
 */
export function useFleetHealth() {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.ops.fleetHealth(),
    queryFn: () => OpsRepository.getFleetHealth(),
    enabled: isAuthenticated,
    refetchInterval: POLL_MS,
    retry: false,
  });
}
