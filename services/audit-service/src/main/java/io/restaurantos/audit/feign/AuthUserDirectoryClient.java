package io.restaurantos.audit.feign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.restaurantos.audit.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;

import java.util.UUID;

/**
 * A user id to a human name — the one thing the audit log cannot answer from its own table.
 *
 * <p>{@code audit_events.user_id} is a UUID and nothing else, deliberately: names change, ids do
 * not, and an audit row that stored a name would record what someone was called on the day rather
 * than who they are. So the id is the fact and the name is resolved at read time, which is exactly
 * the arrangement {@code OrderSettlementDetailService} uses to print "by Shift Cashier 984155" next
 * to a voided order.
 *
 * <p><b>Why auth-service and not the public user list.</b> {@code GET /api/v1/users} is gated on
 * tenant user administration. Holders of {@code audit.log.view} happen to hold that today (both are
 * OWNER and TENANT_ADMIN), and building on that coincidence would mean the day someone grants an
 * auditor role {@code audit.log.view} alone, every name on the screen silently becomes a UUID.
 * {@code GET /internal/auth/users/{id}} is a read bounded by {@code X-Tenant-Id}, gated by the
 * shared internal secret {@link FeignClientConfig} attaches, and routed by nothing at the gateway —
 * so it is unreachable from a browser and needs no permission of the caller's at all.
 *
 * <p><b>Fail-soft.</b> {@code AuditActorDirectory} swallows every failure here and the id renders
 * instead. An unreachable directory must never blank the audit log, and it must never be the reason
 * a row does not appear: the whole value of this screen is that it is complete.
 */
@FeignClient(name = "auth-service", contextId = "auditAuthUserDirectoryClient",
        configuration = FeignClientConfig.class)
public interface AuthUserDirectoryClient {

    @GetMapping("/internal/auth/users/{userId}")
    UserDetailEnvelope getUser(@PathVariable("userId") UUID userId,
                               @RequestHeader("X-Tenant-Id") UUID tenantId);

    /**
     * A deliberate SUBSET of auth-service's {@code ApiResponse<UserDtos.UserDetail>}.
     *
     * <p>{@code ignoreUnknown} everywhere: that response carries assignments, locale, TOTP state and
     * login-audit fields this caller has no business reading, and a strict reader would turn any
     * addition to the user contract into an audit-log outage.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserDetailEnvelope(UserDetailBody data) {

        /** The display name, preferring the full name and falling back to the login email. */
        public String displayName() {
            if (data == null || data.user() == null) {
                return null;
            }
            String fullName = data.user().fullName();
            if (fullName != null && !fullName.isBlank()) {
                return fullName;
            }
            return data.user().email();
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserDetailBody(UserSummaryBody user) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserSummaryBody(UUID id, String email, String fullName) {}
}
