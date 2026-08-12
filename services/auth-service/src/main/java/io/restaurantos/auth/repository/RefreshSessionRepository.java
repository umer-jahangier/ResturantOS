package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.RefreshSessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface RefreshSessionRepository extends JpaRepository<RefreshSessionEntity, UUID> {
    Optional<RefreshSessionEntity> findByTokenHash(String tokenHash);

    List<RefreshSessionEntity> findByUserIdAndRevokedAtIsNull(UUID userId);

    /**
     * Atomically claim a token for single-use rotation (16b-01): revoke it, and report whether THIS
     * caller is the one that did.
     *
     * <h3>Why a conditional UPDATE and not read-then-write</h3>
     *
     * <p>Single-use rotation is only meaningful if "was this token already spent?" and "spend it"
     * are one indivisible step. A read followed by a write lets two concurrent redemptions of the
     * same token both observe {@code revoked_at IS NULL}, both revoke it, and both mint a new
     * session — which is precisely the replay this exists to refuse, passing silently under
     * concurrency. {@code AND s.revokedAt IS NULL} makes the database the arbiter: exactly one
     * caller sees a row count of 1, and every other sees 0.
     *
     * @return 1 if this call revoked a live session, 0 if it was already revoked or does not exist
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE RefreshSessionEntity s SET s.revokedAt = :now "
        + "WHERE s.tokenHash = :tokenHash AND s.revokedAt IS NULL")
    int claimForRotation(@Param("tokenHash") String tokenHash, @Param("now") Instant now);

    /**
     * Revoke every live session a user holds in one scope — the response to a detected token
     * replay (16b-01).
     *
     * <p>Scoped by {@code scope} as well as by user id so that revoking a platform session family
     * can never reach a tenant user's sessions. Belt and braces: RLS already confines the statement
     * to the sentinel tenant, and platform user ids come from {@code platform_db} while tenant user
     * ids come from {@code users}, so a collision would need two independent accidents. This makes
     * the third one impossible too.
     *
     * @return how many sessions were revoked
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE RefreshSessionEntity s SET s.revokedAt = :now "
        + "WHERE s.userId = :userId AND s.scope = :scope AND s.revokedAt IS NULL")
    int revokeAllLiveByUserAndScope(@Param("userId") UUID userId,
                                    @Param("scope") String scope,
                                    @Param("now") Instant now);

    /**
     * Move a live tenant session's ACTIVE BRANCH — what {@code AuthServiceImpl.refresh} re-derives
     * every access token from (S1-16).
     *
     * <h3>Why this statement has to exist</h3>
     *
     * <p>{@code branch_id} was written once, at login, and never again. A branch switch minted an
     * access token on the new branch and left the row alone, so the next full page load — which is
     * a refresh, because the access token is memory-only — resolved permissions against the LOGIN
     * branch and silently put the user back on it. The switch survived exactly as long as one
     * access token.
     *
     * <h3>Why every clause in the WHERE is load-bearing</h3>
     *
     * <ul>
     *   <li>{@code tokenHash} — the active branch belongs to ONE session, i.e. one browser. A
     *       manager who switches on the floor tablet must not move the office desktop's branch.</li>
     *   <li>{@code userId} — the caller's id comes from a signature-verified access token, not from
     *       the cookie. A cookie that is not this user's cannot be repointed even if it is presented.</li>
     *   <li>{@code scope = TENANT} — a control-plane session has no branch and must never acquire
     *       one; that is the first half of an accidental tenant session
     *       ({@code RefreshSessionService.issuePlatform}).</li>
     *   <li>{@code revokedAt IS NULL AND expiresAt &gt; now} — a dead session cannot mint anything,
     *       so repointing it would write a fact nothing will ever read.</li>
     * </ul>
     *
     * <p>RLS is the outer boundary and is not restated here: {@code refresh_sessions} is FORCE RLS
     * with a policy whose {@code USING} clause also serves as its {@code WITH CHECK}, so this
     * statement can only touch rows of the tenant in {@code app.current_tenant_id} — which
     * {@code BranchSwitchService} sets from the caller's own claims.
     *
     * @return 1 if a live session was repointed, 0 if there was nothing to repoint
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE RefreshSessionEntity s SET s.branchId = :branchId "
        + "WHERE s.tokenHash = :tokenHash AND s.userId = :userId AND s.scope = :scope "
        + "AND s.revokedAt IS NULL AND s.expiresAt > :now")
    int updateActiveBranch(@Param("tokenHash") String tokenHash,
                           @Param("userId") UUID userId,
                           @Param("branchId") UUID branchId,
                           @Param("scope") String scope,
                           @Param("now") Instant now);
}
