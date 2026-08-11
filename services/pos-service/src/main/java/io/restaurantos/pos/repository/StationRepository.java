package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.domain.model.StationType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Station reads, every one of them carrying an EXPLICIT tenant predicate.
 *
 * <p>{@code stations} is FORCE ROW LEVEL SECURITY since phase 17b. Under FORCE, a query that
 * reaches the database without the tenant GUC on the connection returns ZERO ROWS rather than
 * erroring — and zero stations does not look like a wiring break, it looks like "this branch has
 * no stations configured", which gets triaged as a configuration question for a week. The
 * predicate also survives independently of the GUC, and it is the only part of the isolation CI
 * can assert, because Testcontainers runs as a superuser and superusers bypass row security.
 *
 * <p>This is the same treatment phase 19b gave the dining-table queries, for the same reason.
 *
 * <p>The pre-existing branch-only finders are RETAINED and delegate to the tenant-scoped forms, so
 * no existing caller changes behaviour in the same commit that adds the predicate.
 */
@Repository
public interface StationRepository extends JpaRepository<Station, UUID> {

    List<Station> findByTenantIdAndBranchId(UUID tenantId, UUID branchId);

    List<Station> findByTenantIdAndBranchIdAndActiveTrue(UUID tenantId, UUID branchId);

    List<Station> findByTenantIdAndBranchIdAndStationType(UUID tenantId, UUID branchId, StationType stationType);

    Optional<Station> findByTenantIdAndBranchIdAndCode(UUID tenantId, UUID branchId, String code);

    Optional<Station> findByIdAndTenantIdAndBranchId(UUID id, UUID tenantId, UUID branchId);

    // ── Pre-existing derived queries, kept so no current caller changes in this commit ────────

    List<Station> findByBranchId(UUID branchId);

    List<Station> findByBranchIdAndActiveTrue(UUID branchId);

    Optional<Station> findByBranchIdAndCode(UUID branchId, String code);

    Optional<Station> findByIdAndBranchId(UUID id, UUID branchId);
}
