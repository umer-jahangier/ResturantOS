package io.restaurantos.platform.service;

import io.restaurantos.platform.entity.UsageRecordEntity;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.platform.repository.UsageRecordRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Usage telemetry recording (PLATFORM-06).
 * Individual services push resource delta records; platform-admin aggregates per tenant.
 */
@Service
public class UsageService {

    private final UsageRecordRepository usageRecordRepository;
    private final TenantRepository tenantRepository;

    public UsageService(UsageRecordRepository usageRecordRepository,
                         TenantRepository tenantRepository) {
        this.usageRecordRepository = usageRecordRepository;
        this.tenantRepository = tenantRepository;
    }

    @Transactional
    public long record(UUID tenantId, String resource, BigDecimal delta) {
        tenantRepository.findById(tenantId)
            .orElseThrow(() -> new IllegalArgumentException("Tenant not found: " + tenantId));

        UsageRecordEntity entry = new UsageRecordEntity();
        entry.setTenantId(tenantId);
        entry.setResource(resource);
        entry.setQty(delta);
        entry.setRecordedAt(Instant.now());
        usageRecordRepository.save(entry);

        return usageRecordRepository.countByTenantIdAndResource(tenantId, resource);
    }

    public long getTotal(UUID tenantId, String resource) {
        Long count = usageRecordRepository.countByTenantIdAndResource(tenantId, resource);
        return count != null ? count : 0L;
    }
}
