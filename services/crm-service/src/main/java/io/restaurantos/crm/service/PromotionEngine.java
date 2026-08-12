package io.restaurantos.crm.service;

import io.restaurantos.crm.dto.CrmDtos.CreatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionResponse;
import io.restaurantos.crm.dto.CrmDtos.PromotionResponse;
import io.restaurantos.crm.entity.LoyaltyAccountEntity;
import io.restaurantos.crm.entity.PromotionEntity;
import io.restaurantos.crm.repository.LoyaltyAccountRepository;
import io.restaurantos.crm.repository.PromotionRepository;
import io.restaurantos.shared.exception.FieldValidationException;
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

    /** {@code discountValue} is a whole-number percentage of the subtotal: {@code 10} means 10%. */
    private static final String TYPE_PERCENT = "PERCENT";

    /** {@code discountValue} is an absolute amount in PAISA: {@code 2_000} means Rs 20.00. */
    private static final String TYPE_FIXED = "FIXED";

    /**
     * Every discount type this engine can turn into money, and therefore the only ones it will
     * store. This set is the whole vocabulary — the database does not constrain
     * {@code promotions.discount_type} (VARCHAR(20), no CHECK), so this is the only place the
     * language is defined. Adding a member without adding its arm to
     * {@link #computeDiscount(PromotionEntity, long)} will not compile past the switch, which is
     * the point: a new promotion type must state its arithmetic before it can price a bill.
     *
     * <p>Note this vocabulary is crm-service's own and is NOT the one in
     * {@code pos-service.order_discounts.type} ({@code FLAT}/{@code PERCENT}). The two never need
     * to match: pos-service records an evaluated promotion as {@code FLAT} with
     * {@code source = 'PROMOTION'}, because by then the rule has already been resolved to "Rs X off
     * this check". See V30__order_discount_source.sql.
     */
    private static final Set<String> SUPPORTED_DISCOUNT_TYPES = Set.of(TYPE_PERCENT, TYPE_FIXED);

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

    /**
     * <p>The type is checked HERE as well as at pricing time, and the two guards answer different
     * questions. This one stops an unpriceable promotion from ever being stored, and can say which
     * field to fix because the value is still in a request. {@link #computeDiscount} is the guard
     * that survives rows this method never saw — everything written before this check existed, and
     * anything inserted by hand or by a migration. A promotion is money, so the door and the till
     * both get a lock.
     */
    public PromotionResponse create(CreatePromotionRequest req) {
        ensureGuc();
        if (!SUPPORTED_DISCOUNT_TYPES.contains(req.discountType())) {
            throw new FieldValidationException(
                    "PROMOTION_TYPE_UNSUPPORTED",
                    "discountType",
                    ("'%s' is not a discount this system can price. Use PERCENT, where the value is "
                            + "a percentage of the bill, or FIXED, where the value is an amount in "
                            + "paisa.").formatted(req.discountType()));
        }
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

    /**
     * Price one eligible promotion against the check, in paisa.
     *
     * <h2>What {@code discountValue} means, per type</h2>
     *
     * <ul>
     *   <li>{@link #TYPE_PERCENT} — a whole-number percentage of the subtotal. {@code 10} is 10%.</li>
     *   <li>{@link #TYPE_FIXED} — an absolute amount already in PAISA. {@code 2_000} is Rs 20.00.</li>
     * </ul>
     *
     * <p>Both are capped at the subtotal, so an offer worth more than the check takes the check to
     * zero and never below it.
     *
     * <h2>Why an unknown type throws instead of falling through</h2>
     *
     * <p>This method used to read {@code if PERCENT ... else treat the value as paisa}. The
     * {@code else} was not a case, it was a guess: every type that is not the single one named —
     * a typo ({@code "PERCENTAGE"}), a rule someone adds later ({@code "BOGO"},
     * {@code "SPEND_AND_SAVE"}), a value that arrived through an API with no whitelist and landed
     * in a column with no CHECK — was silently priced as a raw paisa figure. Nothing anywhere
     * constrained the vocabulary: {@code promotions.discount_type} is {@code VARCHAR(20) NOT NULL}
     * with no CHECK (changeset {@code crm-1.0.0-010e-promotions}), {@code CreatePromotionRequest}
     * declared it {@code @NotBlank} only, and the frontend schema types it {@code z.string()}.
     *
     * <p>A guessed money value is the worst possible failure mode here, because it does not look
     * like one. A {@code BOGO} promotion carrying {@code value = 150} (Rs 150, the rule's own unit)
     * came back as 150 paisa — Rs 1.50 off — and every layer downstream believed it: pos-service's
     * {@code applyPromotions} writes the returned figure to {@code order_discounts.amount_paisa},
     * the guest's bill prints "Automatic promotion Rs 1.50", the Discount Summary reconciles, and
     * no constraint, log line or alert fires. The bill is simply wrong, quietly, forever.
     *
     * <p>So the unknown case refuses. Refusing fails the WHOLE evaluation rather than skipping the
     * offending row, and that is deliberate: {@link #evaluate} returns the BEST discount, and a row
     * this engine cannot price might have been the best one. Dropping it and returning a number
     * anyway is the same guess in a quieter form. An operator gets a 500 with the type named in the
     * log, which is a thing someone fixes; a wrong number on a bill is not.
     *
     * <p>Only eligible promotions reach here, so an unpriceable row that is out of its date/day/
     * hour/tier/item window still costs nothing — the refusal fires only when the bad row is
     * actually a candidate for the guest's money.
     *
     * @throws IllegalStateException if the stored type has no pricing formula. Not
     *         {@link io.restaurantos.shared.exception.FieldValidationException}: by this point the
     *         value is in the database, so there is no request field for a caller to correct. The
     *         shared handler turns it into a logged 500, which is the honest answer — the server is
     *         holding a promotion it cannot price.
     */
    private long computeDiscount(PromotionEntity promo, long subtotalPaisa) {
        return switch (promo.getDiscountType()) {
            case TYPE_PERCENT -> Math.min(subtotalPaisa * promo.getDiscountValue() / 100, subtotalPaisa);
            case TYPE_FIXED -> Math.min(promo.getDiscountValue(), subtotalPaisa);
            case null, default -> throw new IllegalStateException(
                    ("Promotion %s (\"%s\") has discount type '%s', which this engine has no pricing "
                            + "formula for; it knows only %s. Refusing to price the check rather than "
                            + "guess an amount.")
                            .formatted(promo.getId(), promo.getName(), promo.getDiscountType(),
                                    SUPPORTED_DISCOUNT_TYPES));
        };
    }

    private PromotionResponse toResponse(PromotionEntity p) {
        return new PromotionResponse(
                p.getId(), p.getName(), p.getDiscountType(), p.getDiscountValue(),
                p.getStartAt(), p.getEndAt(), p.isActive());
    }
}
