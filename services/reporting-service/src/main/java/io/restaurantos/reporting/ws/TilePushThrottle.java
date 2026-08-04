package io.restaurantos.reporting.ws;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-tile minimum-interval push gate — the thing {@code KdsWebSocketHandler} lacks. A KDS has a
 * handful of tickets; a dashboard during a dinner rush can see 100 ORDER_CLOSED events land inside
 * a second. Pushing a fresh tile recompute for every single one would flood every connected
 * client. This throttle coalesces those into a leading-edge push plus (if anything was
 * suppressed) a trailing-edge flush once the window elapses — so the burst never floods clients,
 * AND the client's final state is never stuck stale forever (a pure drop-the-tail throttle would
 * satisfy "doesn't flood" while silently breaking the "converges within 5 seconds" must_have).
 *
 * <p>{@code tileKey} is {@code branchId + ":" + tileId}. The caller ({@code DashboardTileService})
 * owns recomputation; this class owns ONLY the timing decision.
 */
@Component
public class TilePushThrottle {

    private final Clock clock;
    private final Duration minInterval;

    private final ConcurrentHashMap<String, Instant> lastPushAt = new ConcurrentHashMap<>();
    private final Set<String> dirtyTileKeys = ConcurrentHashMap.newKeySet();

    @Autowired
    public TilePushThrottle(
            @Value("${restaurantos.dashboard.tile-throttle-ms:1000}") long minIntervalMs) {
        this(Clock.systemUTC(), minIntervalMs);
    }

    /** Package-visible constructor for {@code TilePushThrottleTest} — an injectable Clock so
     * the test never sleeps. */
    TilePushThrottle(Clock clock, long minIntervalMs) {
        this.clock = clock;
        this.minInterval = Duration.ofMillis(minIntervalMs);
    }

    /**
     * Returns {@code true} (and records the push) if at least {@code minIntervalMs} has elapsed
     * since the last granted push for this tile — the caller should push immediately. Returns
     * {@code false} otherwise and marks the tile dirty so the trailing sweep
     * ({@link #drainDueTileKeys()}) picks it up once its window elapses.
     */
    public boolean tryAcquire(String tileKey) {
        Instant now = clock.instant();
        boolean[] acquired = {false};
        lastPushAt.compute(tileKey, (key, last) -> {
            if (last == null || Duration.between(last, now).compareTo(minInterval) >= 0) {
                acquired[0] = true;
                return now;
            }
            return last;
        });
        if (acquired[0]) {
            dirtyTileKeys.remove(tileKey);
        } else {
            dirtyTileKeys.add(tileKey);
        }
        return acquired[0];
    }

    /** Test/inspection hook — true if the tile was denied a push and is awaiting the trailing flush. */
    public boolean isDirty(String tileKey) {
        return dirtyTileKeys.contains(tileKey);
    }

    /**
     * Called by the scheduled sweeper. Returns the set of dirty tile keys whose throttle window
     * has since elapsed (ready to be force-flushed with a fresh recompute), clearing their dirty
     * flag and resetting their push clock so they are not immediately re-queued.
     */
    public Set<String> drainDueTileKeys() {
        Instant now = clock.instant();
        Set<String> due = new HashSet<>();
        for (String tileKey : dirtyTileKeys) {
            Instant last = lastPushAt.get(tileKey);
            boolean elapsed = last == null || Duration.between(last, now).compareTo(minInterval) >= 0;
            if (elapsed && dirtyTileKeys.remove(tileKey)) {
                lastPushAt.put(tileKey, now);
                due.add(tileKey);
            }
        }
        return due;
    }
}
