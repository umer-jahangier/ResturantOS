package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.RecoveryCodeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

public interface RecoveryCodeRepository extends JpaRepository<RecoveryCodeEntity, UUID> {

    /**
     * Burns one unused code and reports whether it burned anything.
     *
     * <p><b>This is the redemption check, not a step before it.</b> The obvious spelling — SELECT
     * the row, verify {@code usedAt == null}, then UPDATE — has a window between the read and the
     * write in which a second request can pass the same test, and two concurrent logins would then
     * both succeed on one code. Postgres takes a row lock for the duration of this UPDATE, so the
     * loser of the race sees {@code used_at IS NULL} fail and gets 0 back. A code is spent exactly
     * once no matter how many attempts arrive together.
     *
     * <p>Scoped by {@code user_id} as well as the hash so that a digest collision across accounts —
     * or a caller that got the wrong id — cannot redeem someone else's code. RLS already confines
     * this to one tenant; this confines it to one person.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
        UPDATE user_recovery_codes
           SET used_at = NOW()
         WHERE user_id = :userId
           AND code_hash = :codeHash
           AND used_at IS NULL
        """, nativeQuery = true)
    int redeem(@Param("userId") UUID userId, @Param("codeHash") String codeHash);

    @Query(value = "SELECT COUNT(*) FROM user_recovery_codes WHERE user_id = :userId AND used_at IS NULL",
           nativeQuery = true)
    long countUnused(@Param("userId") UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "DELETE FROM user_recovery_codes WHERE user_id = :userId", nativeQuery = true)
    int deleteAllForUser(@Param("userId") UUID userId);

    /**
     * Serialises regeneration per user by taking the owning row's lock first.
     *
     * <p>Without it, two concurrent regenerations leave a SUPERSET of live codes rather than one
     * set of ten. Under READ COMMITTED each transaction's DELETE cannot see the other's uncommitted
     * INSERTs, so both delete what they can see, both insert ten, and twenty codes commit — half of
     * them belonging to a list the user was told had been replaced. That is the precise failure the
     * feature is supposed to prevent: a user regenerates BECAUSE they believe the old list is
     * compromised, and the old list stays live.
     *
     * <p>Row-count is ignored; the lock is the point, and it is released at commit.
     */
    @Query(value = "SELECT id FROM users WHERE id = :userId FOR UPDATE", nativeQuery = true)
    UUID lockUserForRecoveryCodeWrite(@Param("userId") UUID userId);
}
