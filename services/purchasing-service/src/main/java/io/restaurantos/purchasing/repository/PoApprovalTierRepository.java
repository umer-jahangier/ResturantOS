package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.PoApprovalTier;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface PoApprovalTierRepository extends JpaRepository<PoApprovalTier, UUID> {

    List<PoApprovalTier> findByTenantIdOrderByTierNoAsc(UUID tenantId);
}
