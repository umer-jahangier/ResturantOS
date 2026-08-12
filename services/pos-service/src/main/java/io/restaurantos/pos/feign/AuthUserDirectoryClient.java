package io.restaurantos.pos.feign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.restaurantos.pos.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
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
     * What one user may do AT ONE BRANCH — the authority behind "may this person be handed a cash
     * drawer here" (F11).
     *
     * <p>Unlike {@link #getUser}, callers of this must fail CLOSED. A name is decoration; this is a
     * money-custody decision, and an unreachable directory is not evidence that the target is
     * entitled to a drawer. See {@code TillCashierDirectory.requireCanRunADrawer}.
     *
     * <p>Answers 500 when the user has no active assignment at {@code branchId} — auth-service's
     * {@code PermissionResolver.resolveAtBranch} throws rather than falling back to the user's
     * primary branch, which is the behaviour this call wants: "not rostered here" must not resolve
     * to "here are their permissions somewhere else".
     */
    @GetMapping("/internal/auth/users/{userId}/permissions")
    ResolvedAuth getUserPermissions(@PathVariable("userId") UUID userId,
                                    @RequestParam("branchId") UUID branchId,
                                    @RequestHeader("X-Tenant-Id") UUID tenantId);

    /**
     * Everyone rostered at one branch whose role there grants {@code permission} — the picker
     * behind "open a drawer for…".
     *
     * <p>The permission is named by the caller rather than assumed by auth-service so that this
     * seam stays a general branch-roster query and the POS-specific choice (which capability makes
     * someone a cashier) stays in POS.
     */
    @GetMapping("/internal/auth/branches/{branchId}/staff")
    List<BranchStaff> listBranchStaff(@PathVariable("branchId") UUID branchId,
                                      @RequestParam("permission") String permission,
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

    /**
     * A deliberate SUBSET of auth-service's {@code ResolvedBranchAuth} — the branch the authority
     * was resolved AT, and what it grants there. {@code roles} and {@code attributes} are not read
     * here and are therefore not declared.
     *
     * <p>Returned bare, not wrapped in {@code ApiResponse} — {@code AuthInternalController} returns
     * {@code ResponseEntity<ResolvedBranchAuth>} directly.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record ResolvedAuth(UUID branchId, List<String> permissions) {

        public boolean grants(String permission) {
            return permissions != null && permissions.contains(permission);
        }
    }

    /** One rostered person at a branch. Mirrors auth-service's {@code BranchStaffResponse}. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record BranchStaff(UUID userId, String email, String fullName, String roleCode) {

        /** The label a picker shows: the full name when there is one, the login address otherwise. */
        public String displayName() {
            return fullName != null && !fullName.isBlank() ? fullName : email;
        }
    }
}
