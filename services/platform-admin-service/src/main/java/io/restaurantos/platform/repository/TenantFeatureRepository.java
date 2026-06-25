package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.TenantFeatureEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface TenantFeatureRepository extends JpaRepository<TenantFeatureEntity, TenantFeatureEntity.TenantFeatureKey> {
    List<TenantFeatureEntity> findByTenantId(UUID tenantId);
    Optional<TenantFeatureEntity> findByTenantIdAndFeatureCode(UUID tenantId, String featureCode);
    void deleteAllByTenantId(UUID tenantId);
}
