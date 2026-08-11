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
    long countByTenantIdAndResource(UUID tenantId, String resource);

    /**
     * Every resource name this tenant has at least one record for (19c).
     *
     * <p>Used by {@code UsageService.meters} to surface resources a future producer starts
     * emitting without needing a code change here. Today it returns nothing —
     * {@code select count(*) from usage_records} is 0 — which is exactly why the read endpoint
     * must not report a fabricated number for the resources it enumerates by hand.
     */
    @Query("SELECT DISTINCT u.resource FROM UsageRecordEntity u WHERE u.tenantId = :tenantId ORDER BY u.resource")
    List<String> findDistinctResourcesByTenantId(@Param("tenantId") UUID tenantId);
}
