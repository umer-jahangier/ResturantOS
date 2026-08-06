package io.restaurantos.auth.entity;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A single-use, hashed, expiring credential-bearing token.
 *
 * <p>The table name says "reset" for historical reasons; since 13-08 it serves two flows,
 * discriminated by {@link #purpose}. It was not renamed because renaming a table under a live
 * row-level-security policy, a foreign key and an index buys nothing but risk — the discriminator
 * is what actually keeps the two flows apart, and it is enforced by a check constraint rather than
 * by a name.
 *
 * <p><b>Only the SHA-256 hash of the token is ever stored.</b> The raw value exists in exactly one
 * place — the response that hands it to the caller — and nowhere else: not in a log, not in an
 * exception message, and (for the forced-change purpose) not in any event payload.
 */
@Entity
@Table(name = "password_reset_tokens")
@Getter
@Setter
public class PasswordResetTokenEntity extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false)
    private String tokenHash;

    /**
     * Which flow issued this token, and therefore the only flow that may redeem it.
     *
     * <p>Held as a String rather than an enum mapping so the persisted value is exactly what the
     * database's check constraint lists, with no {@code @Enumerated(ORDINAL)} trap and no chance of
     * a Java-side rename silently changing what is written. The legal values live on
     * {@code PasswordPolicyService.TokenPurpose}, which is the only thing that should ever set it.
     *
     * <p>Defaulted here as well as in the schema so an entity constructed in a test that forgets to
     * set it is a RESET token rather than a constraint violation at flush — matching the column
     * default that backfilled every pre-13-08 row.
     */
    @Column(name = "purpose", nullable = false)
    private String purpose = "RESET";

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "used_at")
    private Instant usedAt;
}
