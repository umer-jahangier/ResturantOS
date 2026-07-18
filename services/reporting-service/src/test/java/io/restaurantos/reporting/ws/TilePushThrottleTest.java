package io.restaurantos.reporting.ws;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pure unit test — an injectable fake Clock so this never sleeps. Proves the leading-edge-push +
 * trailing-edge-flush contract that 12-06's dashboard depends on: a burst coalesces (does NOT
 * flood), but the last event's state is never silently dropped.
 */
class TilePushThrottleTest {

    private static final long MIN_INTERVAL_MS = 1000;

    /** A Clock whose instant() is controlled by the test, advanced explicitly — never Thread.sleep. */
    private static final class MutableClock extends Clock {
        private final AtomicReference<Instant> now;

        MutableClock(Instant start) {
            this.now = new AtomicReference<>(start);
        }

        void advance(Duration by) {
            now.updateAndGet(i -> i.plus(by));
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now.get();
        }
    }

    @Test
    void firstCallForATile_isAcquired() {
        MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        TilePushThrottle throttle = new TilePushThrottle(clock, MIN_INTERVAL_MS);

        assertThat(throttle.tryAcquire("branch-1:todays-revenue")).isTrue();
    }

    @Test
    void immediateSecondCall_isDeniedAndMarkedDirty() {
        MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        TilePushThrottle throttle = new TilePushThrottle(clock, MIN_INTERVAL_MS);

        assertThat(throttle.tryAcquire("branch-1:todays-revenue")).isTrue();
        assertThat(throttle.tryAcquire("branch-1:todays-revenue")).isFalse();
        assertThat(throttle.isDirty("branch-1:todays-revenue")).isTrue();
    }

    @Test
    void afterIntervalElapses_dirtyTileIsFlushedExactlyOnce() {
        MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        TilePushThrottle throttle = new TilePushThrottle(clock, MIN_INTERVAL_MS);
        String key = "branch-1:todays-revenue";

        throttle.tryAcquire(key); // leading push, granted
        throttle.tryAcquire(key); // denied, marked dirty

        clock.advance(Duration.ofMillis(MIN_INTERVAL_MS));

        Set<String> due = throttle.drainDueTileKeys();
        assertThat(due).containsExactly(key);
        assertThat(throttle.isDirty(key)).isFalse();

        // Draining again immediately yields nothing — the flush happened exactly once.
        assertThat(throttle.drainDueTileKeys()).isEmpty();
    }

    @Test
    void hundredRapidCalls_produceExactlyOneLeadingPushAndOneTrailingFlush() {
        MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        TilePushThrottle throttle = new TilePushThrottle(clock, MIN_INTERVAL_MS);
        String key = "branch-1:todays-revenue";

        int grantedCount = 0;
        for (int i = 0; i < 100; i++) {
            if (throttle.tryAcquire(key)) {
                grantedCount++;
            }
        }
        assertThat(grantedCount).isEqualTo(1); // exactly one leading push, not 100

        clock.advance(Duration.ofMillis(MIN_INTERVAL_MS));
        Set<String> due = throttle.drainDueTileKeys();
        assertThat(due).containsExactly(key); // exactly one trailing flush, not 100
    }

    @Test
    void twoDifferentTiles_doNotThrottleEachOther() {
        MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        TilePushThrottle throttle = new TilePushThrottle(clock, MIN_INTERVAL_MS);

        assertThat(throttle.tryAcquire("branch-1:todays-revenue")).isTrue();
        throttle.tryAcquire("branch-1:todays-revenue"); // now throttled

        // A DIFFERENT tile key is unaffected by branch-1:todays-revenue's window.
        assertThat(throttle.tryAcquire("branch-1:todays-orders")).isTrue();
        assertThat(throttle.tryAcquire("branch-2:todays-revenue")).isTrue();
    }
}
