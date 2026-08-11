package io.restaurantos.hr.adms;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Makes a terminal that cannot authenticate <b>visible once, then counted, then summarised</b> — and
 * makes it impossible for a thousand failures to fill a disk or a heap.
 *
 * <h2>Why bounding is the whole design, not a refinement of it</h2>
 *
 * <p>An ADMS terminal polls every three to eight seconds, forever, and it never gives up. One
 * mistyped serial at one branch is therefore roughly <b>fifteen thousand authentication failures a
 * day</b>, from one device. Before this class each of those produced an unhandled-exception stack
 * trace, which is how a single installer's typo becomes a log volume that buries every real failure
 * in the service and eventually fills the disk.
 *
 * <p>The naive fix — log each failure at warn instead of error — reduces the bytes and keeps the
 * problem. The fix here is to log the <em>first</em> failure per serial per window, count the rest,
 * and emit one summary when the window closes. That inverts the signal correctly: a sustained attack
 * becomes <b>louder</b> than a single typo (its summary carries a large count) rather than quieter,
 * which is the property a rate-limited log usually loses.
 *
 * <h2>Why the map is bounded, and why that is a security property</h2>
 *
 * <p>{@code /iclock} is public by necessity — a terminal cannot hold a JWT — so anyone who can send
 * HTTP can choose the serials this map is keyed on. An unbounded map keyed on attacker-chosen input,
 * reachable from a public path, is a memory-exhaustion vector with no authentication in front of it.
 * The map is therefore a fixed-capacity LRU: exceeding the bound evicts the least recently seen
 * serial, so an attacker cycling serials pays for nothing but their own eviction. The cost of
 * eviction is that a cycled serial's suppression window restarts — which produces more log lines, not
 * fewer, and is the correct direction to fail in.
 *
 * <h2>What never appears in a log line or an event</h2>
 *
 * <p>Neither the presented token nor the stored one, in any branch. The <em>cause</em> is recorded
 * for the operator, because an operator needs to know whether a device is unknown or has a stale
 * credential — but the cause is never echoed to the caller: {@code HrExceptionHandler} answers all
 * four causes identically, so the response is not a serial-number oracle. Those two facts are in
 * tension only if you confuse the log with the response.
 *
 * <h2>The event is published only when a tenant genuinely exists</h2>
 *
 * <p>For an unknown serial there is no tenant — that is what "unknown" means, and the resolver
 * deliberately binds no tenant context until every check has passed. An event carrying an invented
 * tenant would be worse than no event: it would put one tenant's audit trail in another's, and the
 * unknown-serial case is exactly the one an investigator would most want to trust. So an unknown
 * serial is <b>logged and counted but not published</b>, and this is stated here rather than left for
 * someone to discover from an empty audit query. A refusal against a device that does exist carries
 * its tenant from the registry row and is published normally.
 */
@Component
public class DeviceAuthFailureRecorder {

    private static final Logger log = LoggerFactory.getLogger(DeviceAuthFailureRecorder.class);

    /** Why a device was refused. For the operator's log and the audit trail — never for the response. */
    public enum Cause { UNKNOWN_SERIAL, INACTIVE_DEVICE, ARCHIVED_DEVICE, BAD_TOKEN, SOURCE_ADDRESS_REFUSED }

    private final DeviceAuthFailureEventPublisher eventPublisher;
    private final Duration window;
    private final int trackedSerialLimit;
    private final Clock clock;

    /** Per-serial suppression state: when this window opened, and how many failures it has absorbed. */
    private static final class WindowState {
        Instant openedAt;
        Cause firstCause;
        int suppressed;
    }

    /**
     * Access-ordered, capacity-bounded. {@code removeEldestEntry} is what makes this safe to key on
     * attacker-chosen input; without it this field is the vulnerability rather than the mitigation.
     */
    private final Map<String, WindowState> tracked;

    @org.springframework.beans.factory.annotation.Autowired
    public DeviceAuthFailureRecorder(
            DeviceAuthFailureEventPublisher eventPublisher,
            @Value("${restaurantos.hr.device-auth-failure.window-minutes:5}") long windowMinutes,
            @Value("${restaurantos.hr.device-auth-failure.tracked-serials:512}") int trackedSerialLimit) {
        this(eventPublisher, windowMinutes, trackedSerialLimit, Clock.systemUTC());
    }

    /** Test seam: the window is asserted by advancing a clock, never by sleeping. */
    DeviceAuthFailureRecorder(
            DeviceAuthFailureEventPublisher eventPublisher,
            long windowMinutes,
            int trackedSerialLimit,
            Clock clock) {
        this.eventPublisher = eventPublisher;
        this.window = Duration.ofMinutes(windowMinutes);
        this.trackedSerialLimit = trackedSerialLimit;
        this.clock = clock;
        this.tracked = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, WindowState> eldest) {
                return size() > DeviceAuthFailureRecorder.this.trackedSerialLimit;
            }
        };
    }

    /**
     * Record one refusal.
     *
     * @param serial   the serial the caller presented; may be anything, including attacker-chosen
     * @param cause    why it was refused
     * @param tenantId the tenant that owns the device, or {@code null} when no device was found —
     *                 in which case nothing is published, for the reason in the class javadoc
     */
    public void record(String serial, Cause cause, UUID tenantId) {
        String key = serial == null ? "<none>" : serial;
        Instant now = clock.instant();

        boolean announceFirst = false;
        boolean closeWindow = false;
        int suppressedAtClose = 0;
        Cause causeAtClose = cause;

        synchronized (tracked) {
            WindowState state = tracked.get(key);
            if (state == null) {
                state = new WindowState();
                state.openedAt = now;
                state.firstCause = cause;
                tracked.put(key, state);
                announceFirst = true;
            } else if (Duration.between(state.openedAt, now).compareTo(window) >= 0) {
                // The window has closed. Summarise what it absorbed, then open a new one for this
                // failure — so a device failing continuously produces one line per window rather
                // than one line per poll, and the count says how bad it is.
                closeWindow = true;
                suppressedAtClose = state.suppressed;
                causeAtClose = state.firstCause;
                state.openedAt = now;
                state.firstCause = cause;
                state.suppressed = 0;
                announceFirst = true;
            } else {
                state.suppressed++;
            }
        }

        if (closeWindow) {
            // Deliberately logged even when the count is zero: "one failure in the last five minutes"
            // and "eleven thousand" must both be legible, and a summary that only appears above a
            // threshold is a summary nobody can reason about the absence of.
            log.warn("Device auth failures summary: serial={} cause={} suppressed={} windowMinutes={}",
                    key, causeAtClose, suppressedAtClose, window.toMinutes());
            eventPublisher.publishSummary(key, causeAtClose, suppressedAtClose, window, tenantId);
        }
        if (announceFirst) {
            // No stack trace, at any level. The exception carries no information the operator does
            // not already have from these three fields, and a stack trace per poll IS the defect.
            log.warn("Device auth refused: serial={} cause={}", key, cause);
            eventPublisher.publishFirstFailure(key, cause, tenantId);
        }
    }

    /** Test seam: how many distinct serials are currently held. Bounded by construction. */
    public int trackedSerialCount() {
        synchronized (tracked) {
            return tracked.size();
        }
    }
}
