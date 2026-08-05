package io.restaurantos.nlq.aiconfig;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface TenantAiConfigRepository extends JpaRepository<TenantAiConfig, UUID> {

    Optional<TenantAiConfig> findByTenantId(UUID tenantId);

    void deleteByTenantId(UUID tenantId);
}
