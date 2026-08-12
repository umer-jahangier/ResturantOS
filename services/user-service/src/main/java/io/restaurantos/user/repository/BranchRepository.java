package io.restaurantos.user.repository;

import io.restaurantos.user.entity.BranchEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface BranchRepository extends JpaRepository<BranchEntity, UUID> {

    Optional<BranchEntity> findByIdAndDeletedAtIsNull(UUID id);

    /**
     * The tenant predicate IN THE QUERY, not only in the policy.
     *
     * <p>26-CONTEXT is explicit that every new query is tenant-scoped in both places. It is not
     * belt-and-braces here: {@code ReceiptConfigIT} measured {@code findByIdAndDeletedAtIsNull}
     * returning ANOTHER tenant's branch under the integration harness. Two independent reasons,
     * neither of which is the one this comment used to give:
     *
     * <ol>
     *   <li>Testcontainers ran PostgreSQL as a SUPERUSER, and a superuser is exempt from row level
     *       security unconditionally — FORCE included — so the {@code tenant_isolation} policy on
     *       {@code branches} was inert for the whole suite. Fixed in {@code BaseUserIT}: the
     *       application now connects as {@code user_service}, NOSUPERUSER NOBYPASSRLS.</li>
     *   <li>The Hibernate {@code tenantFilter} was not in force on the query — and still is not,
     *       on ANY request, in ANY service. {@code TenantFilterInterceptor} enables it in
     *       {@code preHandle}, but every service sets {@code spring.jpa.open-in-view: false}, so
     *       there is no request-bound EntityManager and the filter lands on a temporary session
     *       that is closed before the {@code @Transactional} service call opens its own. Measured,
     *       not inferred — {@code TenantIsolationHarnessIT} captures both statements.</li>
     * </ol>
     *
     * <p>So this method is not belt-and-braces. Until the interceptor defect is fixed it is the
     * only application-layer tenant scoping on this read that actually reaches the database.</p>
     *
     * <p>What this comment previously asserted — that Hibernate does not propagate {@code @Filter}
     * from the {@code TenantAuditableEntity} mapped superclass to the concrete entity — is FALSE,
     * and was disproved by capturing the SQL {@code TenantIsolationHarnessIT} makes Hibernate emit
     * for this very entity with the filter enabled:
     *
     * <pre>
     * select be1_0.id, ..., be1_0.updated_by from branches be1_0 where be1_0.tenant_id = ?
     * </pre>
     *
     * The predicate is there, and {@code BranchEntity} declares no {@code @Filter} of its own. The
     * inherited annotation works. Keep this method regardless — a query that states its own tenant
     * does not depend on an interceptor having run.
     */
    Optional<BranchEntity> findByIdAndTenantIdAndDeletedAtIsNull(UUID id, UUID tenantId);

    List<BranchEntity> findAllByDeletedAtIsNull();

    List<BranchEntity> findAllByIdInAndDeletedAtIsNull(Collection<UUID> ids);

    /**
     * Live AND active. Used by {@code BranchService.listMine}, which is the branch switcher.
     *
     * <p>Separate from the method above rather than replacing it: {@code deletedAt IS NULL} means
     * "this row still exists" and is the right predicate for every read that must not lose a
     * record, while {@code is_active} means "you may work here" and is the right predicate for
     * exactly one question — where may this person go. Collapsing the two would make deactivating
     * a branch look like deleting it everywhere else in the service.
     */
    List<BranchEntity> findAllByIdInAndIsActiveTrueAndDeletedAtIsNull(Collection<UUID> ids);

    boolean existsByName(String name);

    List<BranchEntity> findAllByTenantIdAndDeletedAtIsNull(UUID tenantId);
}
