package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.UsageRecordEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

@Repository
public interface UsageRecordRepository extends JpaRepository<UsageRecordEntity, Long> {

    @Query("SELECT COALESCE(SUM(u.qty), 0) FROM UsageRecordEntity u WHERE u.tenantId = :tenantId AND u.resource = :resource")
    BigDecimal sumQtyByTenantIdAndResource(@Param("tenantId") UUID tenantId, @Param("resource") String resource);

    List<UsageRecordEntity> findByTenantId(UUID tenantId);
}
