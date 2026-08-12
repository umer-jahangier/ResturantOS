package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.BranchServiceCharge;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface BranchServiceChargeRepository extends JpaRepository<BranchServiceCharge, UUID> {

    /**
     * The one policy row for a branch, or empty.
     *
     * <p>The explicit tenant predicate is not redundant with the RLS policy — see
     * {@code MenuCategoryRepository.findByIdAndTenantId} for why. This one is read on the PRICING
     * path, where an empty result means "this branch takes no service charge". A plumbing break
     * that stripped the tenant GUC must therefore present as no charge for this tenant rather
     * than as another tenant's rate applied to this tenant's bill.
     */
    Optional<BranchServiceCharge> findByTenantIdAndBranchId(UUID tenantId, UUID branchId);
}
