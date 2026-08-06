package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.PayrollRunEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PayrollRunRepository extends JpaRepository<PayrollRunEntity, UUID> {

    Optional<PayrollRunEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    Optional<PayrollRunEntity> findByTenantIdAndPeriodMonthAndPeriodYear(UUID tenantId, int periodMonth, int periodYear);

    List<PayrollRunEntity> findAllByTenantId(UUID tenantId);
}
