package io.restaurantos.crm.repository;

import io.restaurantos.crm.entity.LoyaltyTierConfigEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface LoyaltyTierConfigRepository extends JpaRepository<LoyaltyTierConfigEntity, UUID> {

    List<LoyaltyTierConfigEntity> findByTenantIdOrderByMinLifetimeSpendPaisaDesc(UUID tenantId);
}
