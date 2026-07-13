package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.model.PoApprovalTier;
import io.restaurantos.purchasing.domain.model.TenantMatchTolerance;
import io.restaurantos.purchasing.repository.PoApprovalTierRepository;
import io.restaurantos.purchasing.repository.TenantMatchToleranceRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class TenantSetupService {

    private final PoApprovalTierRepository tierRepository;
    private final TenantMatchToleranceRepository toleranceRepository;
    private final TenantContext tenantContext;

    public TenantSetupService(PoApprovalTierRepository tierRepository,
                              TenantMatchToleranceRepository toleranceRepository,
                              TenantContext tenantContext) {
        this.tierRepository = tierRepository;
        this.toleranceRepository = toleranceRepository;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public void ensureDefaults() {
        ensureDefaultTiers();
        ensureDefaultTolerances();
    }

    @Transactional
    public TenantMatchTolerance ensureDefaultTolerances() {
        UUID tenantId = tenantContext.requireTenantId();
        return toleranceRepository.findById(tenantId).orElseGet(() -> {
            TenantMatchTolerance t = new TenantMatchTolerance();
            t.setTenantId(tenantId);
            return toleranceRepository.save(t);
        });
    }

    @Transactional
    public void ensureDefaultTiers() {
        UUID tenantId = tenantContext.requireTenantId();
        if (!tierRepository.findByTenantIdOrderByTierNoAsc(tenantId).isEmpty()) {
            return;
        }
        tierRepository.save(tier(tenantId, 1, 0L, 500_000_00L));
        tierRepository.save(tier(tenantId, 2, 500_000_01L, 2_000_000_00L));
        tierRepository.save(tier(tenantId, 3, 2_000_000_01L, null));
    }

    public int requiredTiersForAmount(long totalPaisa) {
        UUID tenantId = tenantContext.requireTenantId();
        List<PoApprovalTier> tiers = tierRepository.findByTenantIdOrderByTierNoAsc(tenantId);
        if (tiers.isEmpty()) {
            return 1;
        }
        int required = 0;
        for (PoApprovalTier tier : tiers) {
            if (totalPaisa >= tier.getMinAmountPaisa()) {
                required = tier.getTierNo();
            }
        }
        return Math.max(required, 1);
    }

    private static PoApprovalTier tier(UUID tenantId, int tierNo, long min, Long max) {
        PoApprovalTier t = new PoApprovalTier();
        t.setTenantId(tenantId);
        t.setTierNo(tierNo);
        t.setMinAmountPaisa(min);
        t.setMaxAmountPaisa(max);
        return t;
    }
}
