package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.PrintAgent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every finder names {@code tenantId} in its PREDICATE, not only in the RLS policy — the same rule
 * {@code PrintJobRepository} follows, for the same reason: under {@code FORCE ROW LEVEL SECURITY}
 * an unscoped query returns ZERO ROWS rather than erroring, so a wiring break presents as an agent
 * that quietly never prints.
 */
@Repository
public interface PrintAgentRepository extends JpaRepository<PrintAgent, UUID> {

    /**
     * The authentication lookup.
     *
     * <p>Tenant is in the predicate even though {@code lookup_id} is globally unique, because the
     * tenant here comes from the credential the CLIENT presented. Naming it means a caller claiming
     * tenant A while holding tenant B's lookup id finds nothing, rather than finding B's row and
     * relying on the hash comparison alone to notice.
     *
     * <p>Revoked agents are returned, not filtered. The caller decides — and it must, because
     * "revoked" and "never existed" have to produce the SAME generic failure to the client while
     * being distinguishable in the server's own logs.
     */
    @Query("""
           SELECT a FROM PrintAgent a
           WHERE a.tenantId = :tenantId AND a.lookupId = :lookupId AND a.deletedAt IS NULL
           """)
    Optional<PrintAgent> findForAuthentication(@Param("tenantId") UUID tenantId,
                                               @Param("lookupId") String lookupId);

    /** The settings screen's list for one branch, revoked ones included. */
    @Query("""
           SELECT a FROM PrintAgent a
           WHERE a.tenantId = :tenantId AND a.branchId = :branchId AND a.deletedAt IS NULL
           ORDER BY a.createdAt DESC
           """)
    List<PrintAgent> findForBranch(@Param("tenantId") UUID tenantId,
                                   @Param("branchId") UUID branchId);

    @Query("SELECT a FROM PrintAgent a WHERE a.tenantId = :tenantId AND a.id = :id AND a.deletedAt IS NULL")
    Optional<PrintAgent> findScoped(@Param("tenantId") UUID tenantId, @Param("id") UUID id);
}
