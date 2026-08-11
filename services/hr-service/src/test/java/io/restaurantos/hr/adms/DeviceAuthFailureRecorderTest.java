package io.restaurantos.hr.adms;

import io.restaurantos.hr.adms.DeviceAuthFailureRecorder.Cause;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * The window is asserted by advancing a clock, never by sleeping. A test that sleeps for the window
 * is a test that either takes minutes or configures the window down to milliseconds and stops
 * resembling the thing it is testing.
 */
class DeviceAuthFailureRecorderTest {

    /** A clock the test moves by hand. */
    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-08-11T12:00:00Z");

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }

        void advance(Duration d) { now = now.plus(d); }
    }

    private final MutableClock clock = new MutableClock();
    private final DeviceAuthFailureEventPublisher events = mock(DeviceAuthFailureEventPublisher.class);
    private final UUID tenant = UUID.randomUUID();

    private DeviceAuthFailureRecorder recorder(int trackedLimit) {
        return new DeviceAuthFailureRecorder(events, 5, trackedLimit, clock);
    }

    @Test
    void theFirstFailureForASerialIsAnnouncedAndPublished() {
        DeviceAuthFailureRecorder r = recorder(512);

        r.record("SN-1", Cause.BAD_TOKEN, tenant);

        verify(events).publishFirstFailure("SN-1", Cause.BAD_TOKEN, tenant);
        verify(events, never()).publishSummary(any(), any(), anyInt(), any(), any());
    }

    @Test
    void subsequentFailuresInsideTheWindowAreCountedNotAnnounced() {
        DeviceAuthFailureRecorder r = recorder(512);

        // A terminal polls every 3-8 seconds. Ten polls inside one five-minute window.
        for (int i = 0; i < 10; i++) {
            r.record("SN-1", Cause.BAD_TOKEN, tenant);
            clock.advance(Duration.ofSeconds(5));
        }

        verify(events, times(1)).publishFirstFailure("SN-1", Cause.BAD_TOKEN, tenant);
        verify(events, never()).publishSummary(any(), any(), anyInt(), any(), any());
    }

    /**
     * The property a rate-limited log usually loses: a sustained attack must be LOUDER than a single
     * typo, not quieter. The summary carries the count, so eleven thousand failures and one failure
     * produce the same number of lines but obviously different lines.
     */
    @Test
    void whenTheWindowClosesOneSummaryReportsHowManyWereSuppressed() {
        DeviceAuthFailureRecorder r = recorder(512);

        r.record("SN-1", Cause.BAD_TOKEN, tenant);
        for (int i = 0; i < 40; i++) {
            clock.advance(Duration.ofSeconds(5));
            r.record("SN-1", Cause.BAD_TOKEN, tenant);
        }
        // 40 x 5s = 200s, still inside the 5-minute window. Cross it.
        clock.advance(Duration.ofMinutes(6));
        r.record("SN-1", Cause.BAD_TOKEN, tenant);

        verify(events).publishSummary(eq("SN-1"), eq(Cause.BAD_TOKEN), eq(40), eq(Duration.ofMinutes(5)), eq(tenant));
        verify(events, times(2)).publishFirstFailure("SN-1", Cause.BAD_TOKEN, tenant);
    }

    /**
     * Suppression is per serial. Global suppression means one noisy device hides every other device's
     * problem, which is a worse failure than the log volume it was introduced to fix.
     */
    @Test
    void aDifferentSerialIsAnnouncedOnItsOwnFirstFailure() {
        DeviceAuthFailureRecorder r = recorder(512);

        r.record("SN-noisy", Cause.UNKNOWN_SERIAL, null);
        for (int i = 0; i < 20; i++) {
            r.record("SN-noisy", Cause.UNKNOWN_SERIAL, null);
        }
        r.record("SN-quiet", Cause.BAD_TOKEN, tenant);

        verify(events).publishFirstFailure("SN-quiet", Cause.BAD_TOKEN, tenant);
    }

    /**
     * {@code /iclock} is public by necessity, so the map's keys are attacker-chosen. Unbounded, this
     * field would be a memory-exhaustion vector with no authentication in front of it.
     */
    @Test
    void theNumberOfTrackedSerialsIsBoundedByEvictionNotByGrowth() {
        DeviceAuthFailureRecorder r = recorder(8);

        for (int i = 0; i < 5_000; i++) {
            r.record("SN-attacker-" + i, Cause.UNKNOWN_SERIAL, null);
        }

        assertThat(r.trackedSerialCount())
                .as("five thousand distinct serials, eight retained")
                .isEqualTo(8);
    }

    /**
     * An unknown serial has no tenant — that is what unknown means — and the resolver binds no tenant
     * context until every check passes. Publishing with an invented tenant would put one tenant's
     * audit trail into another's, on precisely the case an investigator would most want to trust.
     */
    @Test
    void anUnknownSerialIsRecordedWithNoTenantAndTheEventCarriesNoInventedOne() {
        DeviceAuthFailureRecorder r = recorder(512);

        r.record("SN-does-not-exist", Cause.UNKNOWN_SERIAL, null);

        verify(events).publishFirstFailure("SN-does-not-exist", Cause.UNKNOWN_SERIAL, null);
    }

    /**
     * Structural, because the assertion is about what the code cannot do rather than what it did on
     * one input. No method on the recorder or its publisher accepts a token, so no log line and no
     * payload can contain one — which is stronger than checking one captured string.
     */
    @Test
    void neitherTheRecorderNorItsPublisherHasAnyParameterThatCouldCarryAToken() {
        List<String> suspicious = new ArrayList<>();
        for (Class<?> c : List.of(DeviceAuthFailureRecorder.class, DeviceAuthFailureEventPublisher.class)) {
            for (java.lang.reflect.Method m : c.getDeclaredMethods()) {
                for (java.lang.reflect.Parameter p : m.getParameters()) {
                    String n = p.getName().toLowerCase();
                    if (n.contains("token") || n.contains("secret") || n.contains("password")) {
                        suspicious.add(c.getSimpleName() + "." + m.getName() + "(" + p.getName() + ")");
                    }
                }
            }
        }
        assertThat(suspicious).isEmpty();
    }
}
