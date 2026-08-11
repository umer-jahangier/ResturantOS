package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.PosTerminal;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Terminal reads, every one carrying an EXPLICIT tenant predicate on top of the forced policy.
 *
 * <p>Under FORCE ROW LEVEL SECURITY an unscoped query returns zero rows rather than erroring, and
 * "this branch has no terminals" is a legitimate, extremely common state — so a plumbing break here
 * would present as a configuration question and be triaged as one. The predicate is also the only
 * part of the isolation CI can assert, because Testcontainers runs as a superuser and superusers
 * bypass row security entirely.
 */
@Repository
public interface PosTerminalRepository extends JpaRepository<PosTerminal, UUID> {

    List<PosTerminal> findByTenantIdAndBranchIdOrderByCodeAsc(UUID tenantId, UUID branchId);

    List<PosTerminal> findByTenantIdAndBranchIdAndActiveTrueOrderByCodeAsc(UUID tenantId, UUID branchId);

    Optional<PosTerminal> findByTenantIdAndBranchIdAndCode(UUID tenantId, UUID branchId, String code);

    Optional<PosTerminal> findByIdAndTenantIdAndBranchId(UUID id, UUID tenantId, UUID branchId);
}
