package io.restaurantos.auth.dto.response;

import io.restaurantos.auth.entity.UserEntity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The response shapes of the internal user-lifecycle surface (13-11). 13-12, 13-13 and 13-15 all
 * code against these.
 *
 * <p>Nothing here carries a password, a password hash, a TOTP secret, a reset token or a failed
 * -login counter. {@link UserSummary} and {@link UserDetail} are built from {@link UserEntity} by
 * naming each field, never by serialising the entity — {@code totp_secret} is a column on that
 * entity, and an entity serialised wholesale is one field addition away from publishing it.
 */
public final class UserDtos {

    private UserDtos() {}

    /** One row of the user list. */
    public record UserSummary(
        UUID id,
        String email,
        String fullName,
        String locale,
        boolean active,
        boolean mustChangePassword,
        boolean totpEnabled,
        Instant lastLoginAt,
        Instant createdAt
    ) {
        public static UserSummary of(UserEntity u) {
            return new UserSummary(u.getId(), u.getEmail(), u.getFullName(), u.getLocale(),
                u.isActive(), u.isMustChangePassword(), u.isTotpEnabled(),
                u.getLastLoginAt(), u.getCreatedAt());
        }
    }

    /** One active branch-role assignment, as the detail view reports it. */
    public record UserAssignment(UUID branchId, String roleCode, boolean primary, Long approvalLimitPaisa) {}

    /**
     * A user plus the assignments that decide what they can do.
     *
     * <p>The assignments are part of the detail rather than a second call because a user with none
     * cannot log in at all — {@code PermissionResolver.selectDefaultBranch} throws before a token is
     * minted — so "which roles does this account hold" is the first question anyone looking at a
     * user has, and an empty list here is the visible form of the account being unusable.
     */
    public record UserDetail(UserSummary user, List<UserAssignment> assignments) {}

    /**
     * The outcome of a platform-tier security action that is not a profile edit — clearing a
     * brute-force lockout, or revoking a user's live sessions (superadmin plan).
     *
     * <p>It reports the state AFTER the action rather than a bare success, because both operations
     * are frequently no-ops on a healthy account and an operator needs to tell the two apart: an
     * unlock on an account that was never locked and an unlock that released one look identical
     * from a 200. {@code sessionsRevoked} is the same counter {@code UserActivationChangedPayload}
     * carries, so "revoked 0" honestly means the user held no live refresh session, not that the
     * call did nothing.
     *
     * <p>{@code lockedUntil} is null when the account is not locked. Null is a state here, not a
     * missing value, and must render as "not locked" rather than as a blank date.
     */
    public record UserSecurityState(
        UUID userId,
        String email,
        boolean active,
        Instant lockedUntil,
        int failedLoginCount,
        int sessionsRevoked
    ) {}

    /**
     * The result of creating a user.
     *
     * <p><b>{@code tempPassword} crosses back exactly once and exists nowhere else</b> — not in a
     * log, not in the database (only its bcrypt hash), not in any event payload. Do not add this
     * type to a log statement: a record's generated {@code toString} prints every component, which
     * is why {@link #toString()} is overridden below rather than left to be got right by every
     * future caller.
     *
     * <p>{@code assignedRoleCode} is null when no role was requested; {@code loginable} then says
     * so directly, because an account with no assignment looks created and cannot be used, and that
     * is the exact failure mode blocker B2 was.
     */
    public record CreatedUser(
        UUID id,
        String email,
        String tempPassword,
        boolean mustChangePassword,
        UUID branchId,
        String assignedRoleCode,
        boolean loginable
    ) {
        @Override
        public String toString() {
            return "CreatedUser[id=" + id + ", email=" + email + ", tempPassword=<redacted>"
                + ", mustChangePassword=" + mustChangePassword + ", branchId=" + branchId
                + ", assignedRoleCode=" + assignedRoleCode + ", loginable=" + loginable + "]";
        }
    }
}
