package io.restaurantos.crm.repository;

import io.restaurantos.crm.entity.PromotionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface PromotionRepository extends JpaRepository<PromotionEntity, UUID> {

    List<PromotionEntity> findByTenantIdAndActiveTrue(UUID tenantId);
}
