package io.restaurantos.crm.service;

import io.restaurantos.crm.dto.CrmDtos.CreatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionResponse;
import io.restaurantos.crm.dto.CrmDtos.PromotionResponse;
import io.restaurantos.crm.entity.LoyaltyAccountEntity;
import io.restaurantos.crm.entity.PromotionEntity;
import io.restaurantos.crm.repository.LoyaltyAccountRepository;
import io.restaurantos.crm.repository.PromotionRepository;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
@Transactional
public class PromotionEngine {

    private final PromotionRepository promotionRepo;
    private final LoyaltyAccountRepository loyaltyAccountRepo;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public PromotionEngine(PromotionRepository promotionRepo,
                           LoyaltyAccountRepository loyaltyAccountRepo,
                           TenantContext tenantContext,
                           EntityManager entityManager) {
        this.promotionRepo = promotionRepo;
        this.loyaltyAccountRepo = loyaltyAccountRepo;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    private void ensureGuc() {
        TenantGucHelper.apply(entityManager, tenantContext);
    }

    public EvaluatePromotionResponse evaluate(EvaluatePromotionRequest req) {
        ensureGuc();
        UUID tenantId = tenantContext.requireTenantId();
        Instant at = req.at() != null ? req.at() : Instant.now();
        String customerTier = resolveTier(req.customerId());

        long bestDiscount = 0;
        List<UUID> applied = new ArrayList<>();

        Set<UUID> orderItemIds = new HashSet<>();
        if (req.items() != null) {
            req.items().forEach(i -> orderItemIds.add(i.menuItemId()));
        }

        for (PromotionEntity promo : promotionRepo.findByTenantIdAndActiveTrue(tenantId)) {
            if (!isEligible(promo, at, customerTier, orderItemIds)) {
                continue;
            }
            long discount = computeDiscount(promo, req.subtotalPaisa());
            if (discount > bestDiscount) {
                bestDiscount = discount;
                applied.clear();
                applied.add(promo.getId());
            }
        }

        return new EvaluatePromotionResponse(bestDiscount, applied);
    }

    public PromotionResponse create(CreatePromotionRequest req) {
        ensureGuc();
        PromotionEntity promo = new PromotionEntity();
        promo.setTenantId(tenantContext.requireTenantId());
        promo.setName(req.name());
        promo.setDiscountType(req.discountType());
        promo.setDiscountValue(req.discountValue());
        promo.setStartAt(req.startAt());
        promo.setEndAt(req.endAt());
        promo.setDaysOfWeek(req.daysOfWeek());
        promo.setHourStart(req.hourStart());
        promo.setHourEnd(req.hourEnd());
        promo.setTierFilter(req.tierFilter());
        promo.setMenuItemIds(req.menuItemIds());
        promo.setActive(true);
        return toResponse(promotionRepo.save(promo));
    }

    @Transactional(readOnly = true)
    public List<PromotionResponse> listActive() {
        ensureGuc();
        return promotionRepo.findByTenantIdAndActiveTrue(tenantContext.requireTenantId()).stream()
                .map(this::toResponse)
                .toList();
    }

    private String resolveTier(UUID customerId) {
        if (customerId == null) {
            return null;
        }
        return loyaltyAccountRepo.findByCustomerId(customerId)
                .map(LoyaltyAccountEntity::getTier)
                .orElse(null);
    }

    private boolean isEligible(PromotionEntity promo, Instant at, String customerTier, Set<UUID> orderItems) {
        if (at.isBefore(promo.getStartAt()) || at.isAfter(promo.getEndAt())) {
            return false;
        }
        var zdt = at.atZone(ZoneId.of("Asia/Karachi"));
        if (promo.getDaysOfWeek() != null && promo.getDaysOfWeek().length > 0) {
            int dow = zdt.getDayOfWeek().getValue();
            if (Arrays.stream(promo.getDaysOfWeek()).noneMatch(d -> d == dow)) {
                return false;
            }
        }
        if (promo.getHourStart() != null && promo.getHourEnd() != null) {
            int hour = zdt.getHour();
            if (hour < promo.getHourStart() || hour >= promo.getHourEnd()) {
                return false;
            }
        }
        if (promo.getTierFilter() != null && promo.getTierFilter().length > 0 && customerTier != null) {
            if (Arrays.stream(promo.getTierFilter()).noneMatch(t -> t.equals(customerTier))) {
                return false;
            }
        }
        if (promo.getMenuItemIds() != null && promo.getMenuItemIds().length > 0) {
            if (orderItems.isEmpty()) {
                return false;
            }
            boolean match = Arrays.stream(promo.getMenuItemIds()).anyMatch(orderItems::contains);
            if (!match) {
                return false;
            }
        }
        return true;
    }

    private long computeDiscount(PromotionEntity promo, long subtotalPaisa) {
        if ("PERCENT".equals(promo.getDiscountType())) {
            return Math.min(subtotalPaisa * promo.getDiscountValue() / 100, subtotalPaisa);
        }
        return Math.min(promo.getDiscountValue(), subtotalPaisa);
    }

    private PromotionResponse toResponse(PromotionEntity p) {
        return new PromotionResponse(
                p.getId(), p.getName(), p.getDiscountType(), p.getDiscountValue(),
                p.getStartAt(), p.getEndAt(), p.isActive());
    }
}
