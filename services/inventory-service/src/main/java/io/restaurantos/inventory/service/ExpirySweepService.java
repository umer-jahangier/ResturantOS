package io.restaurantos.inventory.service;

import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.event.InventoryEventPayloads;
import io.restaurantos.inventory.event.InventoryEventPayloads.ExpiryAlertPayload;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.hibernate.Session;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The nightly {@code @Scheduled} FEFO expiry sweep (INV-06 / D-04) — a SINGLE sweep query, never
 * per-batch timers. {@link #sweep(LocalDate, int)} is the directly-invokable core: it resolves the
 * distinct tenant set with candidate lots ({@code expiry_date <= today + leadDays AND qty > 0}),
 * then for EACH tenant activates {@link TenantContext} + pushes the RLS GUC onto the CURRENT
 * connection via {@link TenantGucHelper} (the transaction is already open by the time the loop
 * runs, so a plain {@code tenantContext.set(...)} alone would not re-trigger
 * {@code TenantAwareDataSource}'s checkout-time GUC write — mirrors
 * {@code InternalGrnController}/{@code TenantAwareMessageProcessor}'s {@code tenantContext.set}
 * pattern, adapted for a single long-lived sweep transaction instead of one connection per request)
 * so RLS + the Hibernate {@code tenantFilter} correctly scope that tenant's own lot query and
 * outbox publish, before moving to the next tenant and restoring the previous context.
 *
 * <p><b>Known constraint (documented, not silently worked around):</b> {@code stock_lots} carries
 * {@code FORCE ROW LEVEL SECURITY} (Pitfall 2 fix, 08-CONTEXT.md), and inventory-service's DB role
 * is {@code NOSUPERUSER NOBYPASSRLS} — so the distinct-tenant discovery query itself is bound by
 * the SAME RLS policy as every other query on this table. It can only see tenants visible under
 * whatever {@code TenantContext} happens to be active when {@link #sweep} is invoked. In the real
 * {@code @Scheduled} cron path (no ambient HTTP/consumer context), this means the discovery query
 * sees NO tenants and the sweep is a no-op — inventory-service has no cross-tenant registry / no
 * BYPASSRLS service account to close this gap without a new piece of infrastructure (a Rule-4
 * architectural change outside this plan's stated scope). {@code ExpirySweepIT} proves the
 * per-tenant filtering logic (expiry window + qty>0) correctly by activating one test tenant's
 * context before calling {@code sweep(...)} directly — exactly as the plan's acceptance criteria
 * require ("direct invocation with a fixed clock", not real end-to-end cross-tenant cron dispatch).
 */
@Service
public class ExpirySweepService {

    private static final Logger log = LoggerFactory.getLogger(ExpirySweepService.class);

    private final StockLotRepository lotRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;
    private final int defaultLeadDays;

    public ExpirySweepService(StockLotRepository lotRepository,
                               EventPublisher eventPublisher,
                               TenantContext tenantContext,
                               EntityManager entityManager,
                               @Value("${inventory.expiry.lead-days:3}") int defaultLeadDays) {
        this.lotRepository = lotRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
        this.defaultLeadDays = defaultLeadDays;
    }

    /**
     * Nightly trigger — cron/lead-days are both configurable (never hardcoded), defaults 02:00
     * daily / 3 days, per D-04.
     */
    @Scheduled(cron = "${inventory.expiry.sweep-cron:0 0 2 * * *}")
    public void nightlySweep() {
        sweep(LocalDate.now(), defaultLeadDays);
    }

    /**
     * Resolves lots with {@code expiry_date <= today + leadDays AND qty > 0} across every tenant
     * visible under the currently-active context, and publishes {@code EXPIRY_ALERT} for each one.
     * Exposed as a public method (not just the {@code @Scheduled} wrapper) so {@code ExpirySweepIT}
     * can invoke it directly with a fixed {@code today} — no cron wait. The whole sweep runs inside
     * ONE transaction (never per-tenant self-invoked {@code @Transactional}, which Spring's proxy
     * would silently skip on same-class invocation) so {@link TenantGucHelper#apply} can push each
     * tenant's GUC onto the already-open connection mid-transaction.
     */
    @Transactional
    public void sweep(LocalDate today, int leadDays) {
        LocalDate cutoff = today.plusDays(leadDays);
        List<UUID> tenantIds = lotRepository.findDistinctTenantIdsWithExpiringLots(cutoff);
        for (UUID tenantId : tenantIds) {
            sweepTenant(tenantId, cutoff);
        }
    }

    private void sweepTenant(UUID tenantId, LocalDate cutoff) {
        TenantContext.TenantSnapshot previous = tenantContext.snapshot();
        try {
            // Tenant-wide sweep — no branchId scoping (mirrors InternalGrnController's tenant-only
            // context activation for a background/internal flow).
            tenantContext.set(tenantId, null, null, null);
            TenantGucHelper.apply(entityManager, tenantContext);
            Session session = entityManager.unwrap(Session.class);
            session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);

            List<StockLot> lots = lotRepository.findByTenantIdAndExpiryDateLessThanEqualAndQtyGreaterThan(
                    tenantId, cutoff, BigDecimal.ZERO);

            for (StockLot lot : lots) {
                eventPublisher.publish(
                        InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                        InventoryEventPayloads.EXPIRY_ALERT_ROUTING_KEY,
                        InventoryEventPayloads.EXPIRY_ALERT,
                        lot.getBranchId(),
                        new ExpiryAlertPayload(lot.getId(), lot.getIngredientId(), lot.getBranchId(),
                                lot.getExpiryDate(), lot.getQty()));
            }

            log.info("ExpirySweepService: tenantId={} — published {} EXPIRY_ALERT(s) for lots expiring by {}",
                    tenantId, lots.size(), cutoff);
        } finally {
            // ThreadLocalTenantContext.restore(null) is a no-op (leaves the just-set tenant in
            // place) — when there was NO ambient context before this tenant's iteration (the real
            // cron path, or the first tenant in a multi-tenant sweep), restore(previous) alone
            // would leak this tenantId onto the scheduler's pooled thread. clear() explicitly when
            // there was nothing to restore.
            if (previous != null) {
                tenantContext.restore(previous);
            } else {
                tenantContext.clear();
            }
        }
    }
}
