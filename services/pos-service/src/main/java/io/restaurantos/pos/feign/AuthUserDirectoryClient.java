package io.restaurantos.pos.feign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.restaurantos.pos.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;

import java.util.UUID;

/**
 * A user id to a human name, for the one place POS has to print a person rather than an id.
 *
 * <p><b>Why not the public {@code GET /api/v1/users}.</b> That endpoint is gated on the tenant
 * user-administration permission, and a BRANCH MANAGER does not hold it — measured live:
 * {@code GET /api/v1/users} answers 403 for {@code manager@terrace.local}. The manager IS however
 * authorised to read the order ({@code pos.order.view}), and "who voided this order" is a property
 * of that order, not of the staff directory. Resolving it here keeps the answer inside the
 * permission the caller already has, instead of widening a permission to make a screen appear.
 *
 * <p><b>Why auth-service and not user-service.</b> {@code users.full_name} lives in auth_db;
 * user-service exposes no internal user endpoint at all. {@code GET /internal/auth/users/{id}} is
 * a read (no {@code X-Acting-User-Id} required — see {@code UserLifecycleInternalController}),
 * bounded by {@code X-Tenant-Id}, and gated by the shared internal secret that
 * {@link FeignClientConfig} attaches. The gateway maps no route to {@code /internal/**}, so this
 * seam is not reachable from a browser.
 *
 * <p><b>Fail-soft, like {@link UserBranchClient} and for the same reason.</b> A name is decoration
 * on a list of orders. {@code OrderSettlementDetailService} swallows every failure here and shows
 * the id instead — an unreachable directory must not blank a manager's order screen.
 */
@FeignClient(name = "auth-service", contextId = "authUserDirectoryClient",
        configuration = FeignClientConfig.class)
public interface AuthUserDirectoryClient {

    @GetMapping("/internal/auth/users/{userId}")
    UserDetailEnvelope getUser(@PathVariable("userId") UUID userId,
                              @RequestHeader("X-Tenant-Id") UUID tenantId);

    /**
     * A deliberate SUBSET of auth-service's {@code ApiResponse<UserDtos.UserDetail>}.
     *
     * <p>{@code ignoreUnknown} everywhere: that response carries assignments, locale, TOTP and
     * login-audit fields this caller has no business reading, and a strict reader here would turn
     * any addition to the user contract into an Order Management outage.
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
