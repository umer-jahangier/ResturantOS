package io.restaurantos.nlq.settings;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AiSettingsEventRepository extends JpaRepository<AiSettingsEventEntity, UUID> {

    List<AiSettingsEventEntity> findByTenantIdOrderByAtDesc(UUID tenantId);
}
