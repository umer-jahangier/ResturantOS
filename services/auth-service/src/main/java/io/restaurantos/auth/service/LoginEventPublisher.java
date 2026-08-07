package io.restaurantos.auth.service;

import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class LoginEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(LoginEventPublisher.class);
    static final String EXCHANGE = "auth.topic";

    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public LoginEventPublisher(EventPublisher eventPublisher, TenantContext tenantContext) {
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    public void publishSucceeded(UUID tenantId, UUID branchId, UUID userId, String email, String ip) {
        tenantContext.set(tenantId, branchId, userId, null);
        eventPublisher.publish(EXCHANGE, "auth.user.login_succeeded", "USER_LOGIN_SUCCEEDED", branchId,
            payload(userId, email, ip));
    }

    public void publishFailed(UUID tenantId, UUID userId, String email, String ip) {
        tenantContext.set(tenantId, null, userId, null);
        eventPublisher.publish(EXCHANGE, "auth.user.login_failed", "USER_LOGIN_FAILED", null,
            payload(userId, email, ip));
    }

    /**
     * A failed login for an address that belongs to no user has no {@code userId}, and {@code ip} is
     * absent whenever the request arrives without a resolvable client address. {@link Map#of} rejects
     * null values, so building the payload with it threw an NPE out of the login path and turned the
     * 401 into a 500 — which also undid the constant-time dummy-hash comparison in
     * {@code AuthServiceImpl.login}: a 500 for unknown addresses and a 401 for known ones is exactly
     * the enumeration oracle that comparison exists to prevent. A null-tolerant map keeps the failure
     * responses indistinguishable and still records which fields were unknown.
     */
    private static Map<String, Object> payload(UUID userId, String email, String ip) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("userId", userId);
        payload.put("email", email);
        payload.put("ip", ip);
        return payload;
    }

    public void logUnknownTenant(String tenantSlug, String email, String ip) {
        log.warn("Login attempt for unknown tenant slug={} email={} ip={}", tenantSlug, email, ip);
    }

    /**
     * A unified (no-slug) login that matched nothing anywhere — 16a-01.
     *
     * <p>Distinct from {@link #logUnknownTenant} because it is a distinct event: nobody typed a
     * tenant, so nothing about a tenant was wrong. Reusing that line would have printed
     * {@code slug=null} on every failed email-first attempt and taught whoever greps the logs that
     * "unknown tenant" means nothing.
     *
     * <p>No AMQP event is published. {@link #publishFailed} carries a {@code tenantId} and is
     * consumed by audit-service inside a tenant's own trail; a credential that matched no tenant has
     * no trail to belong to, and attributing it to one would put a fabricated tenant id in the audit
     * record. The per-candidate failures that DID touch a real account are published individually by
     * the resolver's failure sink, which is where the tenant is known.
     *
     * <p><b>The password is not a parameter of this method and must never become one.</b> That is
     * the whole reason it takes the three fields it takes: an operator investigating a burst of
     * refusals needs the address, the source and the time, and nothing that would put a live
     * credential — possibly a correct one for some other system — into a log aggregator.
     */
    public void logUnifiedRefusal(String email, String ip) {
        log.warn("[unified-login] refused: credential matched no tenant and no platform user — "
            + "email={} ip={}", email, ip);
    }
}
