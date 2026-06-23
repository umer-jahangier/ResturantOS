package io.restaurantos.auth.service;

import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

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
            Map.of("userId", userId, "email", email, "ip", ip));
    }

    public void publishFailed(UUID tenantId, UUID userId, String email, String ip) {
        tenantContext.set(tenantId, null, userId, null);
        eventPublisher.publish(EXCHANGE, "auth.user.login_failed", "USER_LOGIN_FAILED", null,
            Map.of("userId", userId, "email", email, "ip", ip));
    }

    public void logUnknownTenant(String tenantSlug, String email, String ip) {
        log.warn("Login attempt for unknown tenant slug={} email={} ip={}", tenantSlug, email, ip);
    }
}
