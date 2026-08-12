package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.TenantTaxPolicy;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface TenantTaxPolicyRepository extends JpaRepository<TenantTaxPolicy, UUID> {

    /**
     * The one policy row for a tenant, or empty.
     *
     * <p>The explicit tenant predicate is not redundant with the RLS policy — see
     * {@code BranchServiceChargeRepository.findByTenantIdAndBranchId} for why, and the reasoning
     * is sharper here. This is read on the PRICING path, where an empty result means "tax the net"
     * — the default. A plumbing break that stripped the tenant GUC must therefore present as this
     * tenant's default rather than as another tenant's tax position applied to this tenant's bill,
     * which would mis-state a return that somebody signs.
     */
    Optional<TenantTaxPolicy> findByTenantId(UUID tenantId);
}
