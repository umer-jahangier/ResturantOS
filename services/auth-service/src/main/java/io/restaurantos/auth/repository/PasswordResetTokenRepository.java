package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.PasswordResetTokenEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetTokenEntity, UUID> {

    /**
     * Kept for the hash-only lookups that predate the purpose discriminator. New callers should use
     * {@link #findByTokenHashAndPurpose}: matching the hash alone would let a token issued by one
     * flow be redeemed by the other, which is threat T-13-08-E.
     */
    Optional<PasswordResetTokenEntity> findByTokenHash(String tokenHash);

    Optional<PasswordResetTokenEntity> findByTokenHashAndPurpose(String tokenHash, String purpose);

    /**
     * Marks a token used, but ONLY if it is currently unused and unexpired, and reports whether it
     * did.
     *
     * <p><b>This is the whole of the single-use guarantee, and it has to be one statement.</b> The
     * obvious implementation — read the row, check {@code usedAt == null}, then write — is a
     * check-then-act race: two requests presenting the same token concurrently both read null and
     * both proceed, and the token is used twice. As a conditional UPDATE it cannot happen. Under
     * Postgres' READ COMMITTED the second statement blocks on the first's row lock, then
     * re-evaluates its WHERE clause against the committed new version, sees {@code used_at} set,
     * and reports 0 rows affected. The caller treats 0 as "this token is not redeemable" — which is
     * also, and identically, the answer for a token that never existed.
     *
     * <p>Expiry is evaluated here rather than in Java for the same reason: one predicate, one
     * clock, evaluated atomically with the claim.
     *
     * <p>Native rather than JPQL so it is unmistakably a single round trip, and so
     * {@code updated_at} (an auditing column JPA would otherwise manage) is written explicitly.
     * Runs under the tenant_isolation policy like every other statement here, so the caller must
     * already have established the tenant GUC.
     *
     * @return 1 when this call is the one that claimed the token, 0 otherwise
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
        UPDATE password_reset_tokens
           SET used_at = :now, updated_at = :now
         WHERE token_hash = :tokenHash
           AND purpose = :purpose
           AND used_at IS NULL
           AND expires_at > :now
        """, nativeQuery = true)
    int claimIfRedeemable(@Param("tokenHash") String tokenHash,
                          @Param("purpose") String purpose,
                          @Param("now") Instant now);

    /**
     * Retires every outstanding token of one purpose for one user.
     *
     * <p>Called immediately before a new token of that purpose is issued, so a user never holds two
     * live tokens for the same flow. Without it, every refused login would mint another valid
     * ten-minute credential and leave the previous ones alive — an attacker who ever saw one would
     * keep a usable window open by doing nothing.
     *
     * <p>Scoped by purpose as well as by user: issuing a forced-change token must not quietly
     * cancel a password reset the same person is halfway through in another tab.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
        UPDATE password_reset_tokens
           SET used_at = :now, updated_at = :now
         WHERE user_id = :userId
           AND purpose = :purpose
           AND used_at IS NULL
        """, nativeQuery = true)
    int invalidateOutstanding(@Param("userId") UUID userId,
                              @Param("purpose") String purpose,
                              @Param("now") Instant now);
}
