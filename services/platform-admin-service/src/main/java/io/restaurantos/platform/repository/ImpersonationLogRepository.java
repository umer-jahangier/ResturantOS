package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.ImpersonationLogEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ImpersonationLogRepository extends JpaRepository<ImpersonationLogEntity, Long> {
    List<ImpersonationLogEntity> findByTenantIdOrderByStartedAtDesc(UUID tenantId);
}
