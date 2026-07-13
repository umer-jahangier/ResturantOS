package io.restaurantos.crm.service;

import io.restaurantos.crm.entity.LoyaltyAccountEntity;
import io.restaurantos.crm.entity.LoyaltyTierConfigEntity;
import io.restaurantos.crm.entity.LoyaltyTransactionEntity;
import io.restaurantos.crm.repository.LoyaltyAccountRepository;
import io.restaurantos.crm.repository.LoyaltyTierConfigRepository;
import io.restaurantos.crm.repository.LoyaltyTransactionRepository;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class LoyaltyService {

    private final LoyaltyAccountRepository accountRepo;
    private final LoyaltyTransactionRepository txRepo;
    private final LoyaltyTierConfigRepository tierConfigRepo;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public LoyaltyService(LoyaltyAccountRepository accountRepo,
                          LoyaltyTransactionRepository txRepo,
                          LoyaltyTierConfigRepository tierConfigRepo,
                          TenantContext tenantContext,
                          EntityManager entityManager) {
        this.accountRepo = accountRepo;
        this.txRepo = txRepo;
        this.tierConfigRepo = tierConfigRepo;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    private void ensureGuc() {
        TenantGucHelper.apply(entityManager, tenantContext);
    }

    public void accrueForOrder(UUID customerId, UUID orderId, long totalPaisa) {
        ensureGuc();
        UUID tenantId = tenantContext.requireTenantId();
        LoyaltyAccountEntity account = accountRepo.findByCustomerId(customerId)
                .orElseThrow(() -> new IllegalArgumentException("Loyalty account not found"));

        long pointsPerPkr = resolvePointsPerPkr(tenantId, account.getTier());
        long points = pointsPerPkr > 0 ? totalPaisa / pointsPerPkr : 0;
        if (points <= 0) {
            account.setLifetimeSpendPaisa(account.getLifetimeSpendPaisa() + totalPaisa);
            checkTierUpgrade(account);
            accountRepo.save(account);
            return;
        }

        LoyaltyTransactionEntity tx = new LoyaltyTransactionEntity();
        tx.setTenantId(tenantId);
        tx.setCustomerId(customerId);
        tx.setOrderId(orderId);
        tx.setType("ACCRUAL");
        tx.setPoints(points);
        txRepo.save(tx);

        account.setPointsBalance(account.getPointsBalance() + points);
        account.setLifetimeSpendPaisa(account.getLifetimeSpendPaisa() + totalPaisa);
        checkTierUpgrade(account);
        accountRepo.save(account);
    }

    public void debitForRefund(UUID customerId, UUID orderId, long refundPaisa) {
        ensureGuc();
        UUID tenantId = tenantContext.requireTenantId();
        LoyaltyAccountEntity account = accountRepo.findByCustomerId(customerId)
                .orElseThrow(() -> new IllegalArgumentException("Loyalty account not found"));

        long pointsPerPkr = resolvePointsPerPkr(tenantId, account.getTier());
        long points = pointsPerPkr > 0 ? refundPaisa / pointsPerPkr : 0;
        if (points <= 0) {
            return;
        }
        points = Math.min(points, account.getPointsBalance());

        LoyaltyTransactionEntity tx = new LoyaltyTransactionEntity();
        tx.setTenantId(tenantId);
        tx.setCustomerId(customerId);
        tx.setOrderId(orderId);
        tx.setType("DEBIT");
        tx.setPoints(points);
        txRepo.save(tx);

        account.setPointsBalance(account.getPointsBalance() - points);
        accountRepo.save(account);
    }

    void checkTierUpgrade(LoyaltyAccountEntity account) {
        UUID tenantId = account.getTenantId();
        List<LoyaltyTierConfigEntity> tiers =
                tierConfigRepo.findByTenantIdOrderByMinLifetimeSpendPaisaDesc(tenantId);
        for (LoyaltyTierConfigEntity tier : tiers) {
            if (account.getLifetimeSpendPaisa() >= tier.getMinLifetimeSpendPaisa()) {
                account.setTier(tier.getTier());
                return;
            }
        }
    }

    private long resolvePointsPerPkr(UUID tenantId, String tier) {
        return tierConfigRepo.findByTenantIdOrderByMinLifetimeSpendPaisaDesc(tenantId).stream()
                .filter(t -> t.getTier().equals(tier))
                .map(LoyaltyTierConfigEntity::getPointsPerPkrPaisa)
                .findFirst()
                .orElse(100L);
    }

    /** Seed default tier config for a new tenant when none exists. */
    public void ensureTierConfig(UUID tenantId) {
        if (!tierConfigRepo.findByTenantIdOrderByMinLifetimeSpendPaisaDesc(tenantId).isEmpty()) {
            return;
        }
        seedTier(tenantId, "BRONZE", 0, 100);
        seedTier(tenantId, "SILVER", 5_000_000, 100);
        seedTier(tenantId, "GOLD", 20_000_000, 100);
    }

    private void seedTier(UUID tenantId, String tier, long minSpend, long pointsPerPkr) {
        LoyaltyTierConfigEntity cfg = new LoyaltyTierConfigEntity();
        cfg.setTenantId(tenantId);
        cfg.setTier(tier);
        cfg.setMinLifetimeSpendPaisa(minSpend);
        cfg.setPointsPerPkrPaisa(pointsPerPkr);
        tierConfigRepo.save(cfg);
    }
}
