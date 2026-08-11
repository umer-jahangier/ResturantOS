package io.restaurantos.hr.adms;

import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Puts a device-authentication refusal into the audit trail, in a transaction of its own.
 *
 * <h2>Why {@code REQUIRES_NEW} is load-bearing here</h2>
 *
 * <p>{@code DeviceAuthResolver.resolve} is {@code @Transactional} and every refusal leaves it by
 * throwing. The outbox row is written inside the caller's transaction on purpose — that is the entire
 * point of the outbox pattern — so an event enqueued on the resolver's transaction <b>rolls back with
 * the refusal that caused it</b>, and the audit trail records nothing at all. The failure is silent
 * and looks exactly like a working system. A separate transaction is the only arrangement in which
 * the refusal survives.
 *
 * <h2>Why the tenant is bound here and cleared in a finally</h2>
 *
 * <p>{@code DomainEventPublisher} reads the tenant from {@link TenantContext} and throws if none is
 * bound. On the refusal path none is: {@code DeviceAuthResolver} deliberately binds tenant context
 * only <em>after</em> every check has passed, so that a rejected request never leaks context — an
 * ordering this phase is explicitly forbidden to weaken. This class therefore binds the tenant it was
 * handed, for the duration of one publish, and clears it in a {@code finally}. That is the same
 * discipline the resolver and the controller use on a pooled thread, applied in a narrower scope. It
 * does not change the resolver's ordering; it borrows the tenant the registry row already named.
 *
 * <p>When no tenant was found — an unknown serial — nothing is published. See
 * {@link DeviceAuthFailureRecorder} for why an invented tenant would be worse than no event.
 */
@Component
public class DeviceAuthFailureEventPublisher {

    private static final String HR_EXCHANGE = "hr.topic";

    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public DeviceAuthFailureEventPublisher(EventPublisher eventPublisher, TenantContext tenantContext) {
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void publishFirstFailure(String serial, DeviceAuthFailureRecorder.Cause cause, UUID tenantId) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("serialNo", serial);
        payload.put("cause", cause.name());
        payload.put("count", 1);
        publish("hr.device.auth_failed", "DEVICE_AUTH_FAILED", payload, tenantId);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void publishSummary(String serial, DeviceAuthFailureRecorder.Cause cause, int suppressed,
                               Duration window, UUID tenantId) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("serialNo", serial);
        payload.put("cause", cause.name());
        payload.put("suppressedCount", suppressed);
        payload.put("windowMinutes", window.toMinutes());
        publish("hr.device.auth_failed_summary", "DEVICE_AUTH_FAILED_SUMMARY", payload, tenantId);
    }

    /**
     * No token material of any kind reaches this method: the payload maps above carry a serial, a
     * cause enum and integers, and nothing else. A serial is printed on the outside of the device.
     */
    private void publish(String routingKey, String eventType, Map<String, Object> payload, UUID tenantId) {
        if (tenantId == null) {
            return; // unknown serial: no tenant exists to attribute this to, and none will be invented
        }
        TenantContext.TenantSnapshot previous = tenantContext.snapshot();
        try {
            tenantContext.set(tenantId, null, null, null);
            eventPublisher.publish(HR_EXCHANGE, routingKey, eventType, null, payload);
        } finally {
            tenantContext.restore(previous);
        }
    }
}
