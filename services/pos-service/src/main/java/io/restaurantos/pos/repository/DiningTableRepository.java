package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.DiningTable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * <h2>Why every query below names {@code tenantId} explicitly</h2>
 *
 * <p>All 16 tables in {@code pos_db} run {@code FORCE ROW LEVEL SECURITY} (V11, phase 17b),
 * so RLS alone would already scope these reads. The explicit predicate is the second layer,
 * and it exists because of how forced RLS fails: an unscoped query returns <em>zero rows
 * rather than an error</em>. If the {@code app.current_tenant_id} GUC is ever unset on a
 * connection — a background thread, a pooled checkout that missed the interceptor, a future
 * @Async path — the symptom is "the tables screen is empty", which is indistinguishable from
 * "this branch has no tables yet" and will be triaged as a data problem for a week.
 *
 * <p>With the predicate in the JPQL, the tenant scope survives independently of the GUC, and
 * a superuser test container (Testcontainers runs Postgres as one, and superusers bypass RLS
 * entirely) can actually observe the scoping — which is the half of tenancy an integration
 * test is capable of proving. See {@code TableCatalogueIT}.
 */
@Repository
public interface DiningTableRepository extends JpaRepository<DiningTable, UUID> {

    /**
     * Service-time list: the picker a waiter uses mid-order. Active-only and soft-delete-aware —
     * a retired table must not be selectable.
     */
    @Query("""
            SELECT t FROM DiningTable t
             WHERE t.tenantId = :tenantId
               AND t.branchId = :branchId
               AND t.active = TRUE
               AND t.deletedAt IS NULL
             ORDER BY t.tableNumber ASC
            """)
    List<DiningTable> findActiveByTenantAndBranch(@Param("tenantId") UUID tenantId,
                                                  @Param("branchId") UUID branchId);

    /**
     * Catalogue list: includes retired tables so a manager can find and reactivate one.
     * Gated on {@code pos.tables.admin} in the service — a waiter never sees this.
     */
    @Query("""
            SELECT t FROM DiningTable t
             WHERE t.tenantId = :tenantId
               AND t.branchId = :branchId
               AND t.deletedAt IS NULL
             ORDER BY t.tableNumber ASC
            """)
    List<DiningTable> findAllByTenantAndBranch(@Param("tenantId") UUID tenantId,
                                               @Param("branchId") UUID branchId);

    @Query("""
            SELECT t FROM DiningTable t
             WHERE t.id = :id
               AND t.tenantId = :tenantId
               AND t.branchId = :branchId
               AND t.deletedAt IS NULL
            """)
    Optional<DiningTable> findByIdTenantAndBranch(@Param("id") UUID id,
                                                  @Param("tenantId") UUID tenantId,
                                                  @Param("branchId") UUID branchId);

    /**
     * Backs the friendly duplicate message. The DB has the real guarantee
     * ({@code uq_dining_table_branch_number UNIQUE (tenant_id, branch_id, table_number)}) —
     * this check exists so the manager reads "Table 7 already exists in this branch" instead
     * of a 500 from a constraint violation. {@code excludeId} lets rename skip its own row.
     *
     * <p>Deliberately NOT filtered on {@code is_active}: a retired "Table 7" still owns that
     * number as far as the unique constraint is concerned, so offering to create a second one
     * would produce exactly the 500 this method exists to avoid. The manager is told to
     * reactivate the existing one instead.
     */
    @Query("""
            SELECT COUNT(t) > 0 FROM DiningTable t
             WHERE t.tenantId = :tenantId
               AND t.branchId = :branchId
               AND LOWER(t.tableNumber) = LOWER(:tableNumber)
               AND t.deletedAt IS NULL
               AND (:excludeId IS NULL OR t.id <> :excludeId)
            """)
    boolean existsByTableNumber(@Param("tenantId") UUID tenantId,
                                @Param("branchId") UUID branchId,
                                @Param("tableNumber") String tableNumber,
                                @Param("excludeId") UUID excludeId);
}
