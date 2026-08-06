package io.restaurantos.user.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * The request and response shapes of the PUBLIC tenant-admin user surface (D-11, blocker B3).
 *
 * <h2>Why these are separate types from auth-service's {@code UserDtos}</h2>
 *
 * <p>They currently coincide field for field, and that is exactly when the duplication is worth
 * writing down: the internal contract belongs to auth-service and may be changed by whoever owns
 * it, while this one is a published API that Phase 14's tenant-admin UI codes against. Sharing one
 * type makes every internal change an unannounced public API break, discovered by a browser. Two
 * types make it a compile error here — in the mapping — which is where someone can decide what the
 * public shape should do about it.
 *
 * <p>Nothing here carries a password hash, a TOTP secret, a reset token or a failed-login counter.
 * {@link CreatedUser#tempPassword} is the single exception and crosses back exactly once; see its
 * comment.
 */
public final class UserAdminDtos {

    private UserAdminDtos() {}

    // ── Responses ────────────────────────────────────────────────────────────────────────────

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
    ) {}

    /** One active branch-role assignment. */
    public record UserAssignment(UUID branchId, String roleCode, boolean primary, Long approvalLimitPaisa) {}

    /**
     * A user plus the assignments that decide what they can do.
     *
     * <p>The assignments travel with the user rather than behind a second call because an account
     * with none cannot log in at all — that is the exact failure mode blocker B2 was — so an empty
     * list here is the visible form of an unusable account.
     */
    public record UserDetail(UserSummary user, List<UserAssignment> assignments) {}

    /**
     * The result of creating a user.
     *
     * <p><b>{@code tempPassword} crosses back exactly once and exists nowhere else</b> — not in a
     * log, not in the database (only its bcrypt hash), not in any event payload. Do not put this
     * type in a log statement: a record's generated {@code toString} prints every component, which
     * is why {@link #toString()} is overridden here rather than left to be got right by every
     * future caller.
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

    // ── Requests ─────────────────────────────────────────────────────────────────────────────

    /**
     * Create one user in the CALLER'S OWN tenant.
     *
     * <p><b>There is no tenant id here, and the absence is the enforcement.</b> The tenant comes
     * from the verified JWT and from nowhere else; a field a caller could fill in is a field a
     * caller could fill in with somebody else's tenant. Same reasoning for the absence of a
     * password field: only a generated temporary one is ever set, so there is nothing to supply
     * and no branch of code that could honour it.
     *
     * <p>{@code branchId} and {@code roleCode} travel together — a role without a branch is not an
     * assignment, and a branch without a role is not one either. Both absent is legal and means
     * "create the account, assign later"; the response says {@code loginable:false} so that is
     * known immediately rather than discovered at that user's first login.
     */
    public record CreateUserRequest(
        @NotBlank @Email @Size(max = 255) String email,
        @Size(max = 255) String fullName,
        @Size(max = 10) String locale,
        UUID branchId,
        String roleCode
    ) {}

    /**
     * Patch a user's profile. Every field is optional and a null field is left alone, so a client
     * rendering three fields cannot blank a fourth it never showed.
     *
     * <p>{@code active} is a boxed {@link Boolean} for that reason. A primitive would default to
     * {@code false}, and every profile edit would silently deactivate the user.
     *
     * <p><b>A body carrying a password is refused, not ignored.</b> Jackson's default is to drop
     * unknown keys and answer 200, which leaves an administrator certain they set a password the
     * platform has never heard of — discovered only when that user cannot log in with it.
     * {@link JsonAnySetter} catches whatever was actually sent rather than a fixed list, so
     * {@code password}, {@code newPassword}, {@code passwordHash} and {@code temp_password} all
     * trip it while an ordinary unknown field is still tolerated. auth-service enforces the same
     * rule on the internal endpoint; this copy exists so the public surface refuses it in one hop
     * with a message that names the field, and so the public contract states it. <b>The submitted
     * value is never stored, never logged and never echoed</b> — it is a credential the caller has
     * just put on the wire.
     *
     * <p>A mutable class rather than a record because {@code @JsonAnySetter} needs a setter.
     */
    public static final class UpdateUserRequest {

        private static final List<String> PASSWORD_ISH = List.of("password", "passwd", "pwd", "secret");

        @Size(max = 255)
        private String fullName;

        @Size(max = 10)
        private String locale;

        private Boolean active;

        private String rejectedField;

        public String fullName() { return fullName; }
        public void setFullName(String fullName) { this.fullName = fullName; }

        public String locale() { return locale; }
        public void setLocale(String locale) { this.locale = locale; }

        public Boolean active() { return active; }
        public void setActive(Boolean active) { this.active = active; }

        /** The password-ish key a caller sent, or null. Never its value. */
        public String rejectedField() { return rejectedField; }

        @JsonAnySetter
        public void unknownProperty(String name, Object ignoredValue) {
            String normalised = name.toLowerCase(Locale.ROOT).replace("_", "");
            if (PASSWORD_ISH.stream().anyMatch(normalised::contains)) {
                // The NAME is kept so the refusal can say what was wrong. The VALUE is discarded
                // here and now, before anything can log it.
                this.rejectedField = name;
            }
        }
    }
}
