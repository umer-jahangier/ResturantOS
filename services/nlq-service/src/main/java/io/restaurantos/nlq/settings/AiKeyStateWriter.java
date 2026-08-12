package io.restaurantos.nlq.settings;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Records what the provider just told us about a tenant's key, <b>in its own transaction</b>.
 *
 * <h3>REQUIRES_NEW is the entire reason this class exists</h3>
 *
 * <p>The 401 that proves a key is bad arrives on a request that is about to fail. If the
 * {@code key_state} update joined that request's transaction it would roll back with it, and the
 * settings screen would keep reporting {@code VERIFIED} forever — a control that reads correctly
 * and never runs, which is precisely the defect class this whole change set exists to remove.
 *
 * <p>It is a separate {@code @Component} rather than a method on the service for a mechanical
 * reason too: Spring's {@code @Transactional} is proxy-based, so a self-invocation from inside the
 * same bean would silently NOT start a new transaction. That failure is invisible — the code reads
 * as though it were isolated and simply is not.
 *
 * <h3>Never throws into the caller</h3>
 *
 * <p>The caller is already handling a provider failure and must report that failure, not a
 * bookkeeping error that happened while noting it down. A write failure here is logged and
 * swallowed.
 */
@Component
public class AiKeyStateWriter {

    private static final Logger log = LoggerFactory.getLogger(AiKeyStateWriter.class);

    private final TenantAiSettingsRepository settingsRepository;
    private final AiSettingsEventRepository eventRepository;

    public AiKeyStateWriter(TenantAiSettingsRepository settingsRepository,
                            AiSettingsEventRepository eventRepository) {
        this.settingsRepository = settingsRepository;
        this.eventRepository = eventRepository;
    }

    /**
     * Flips the tenant's key to {@link KeyState#REJECTED} and stamps {@code last_rejected_at}.
     *
     * <p>Call ONLY for a real 401/403 from the provider. A timeout or a 5xx must never brand a
     * good key as bad — the tenant would be sent to replace a key that was fine.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markRejected(UUID tenantId) {
        try {
            settingsRepository.findByTenantId(tenantId).ifPresent(settings -> {
                if (settings.getKeyState() == KeyState.REJECTED) {
                    return; // Already known; don't churn the row or duplicate the audit event.
                }
                Instant now = Instant.now();
                settings.markRejected(now);
                settingsRepository.save(settings);
                eventRepository.save(new AiSettingsEventEntity(
                        tenantId, null, AiSettingsEventEntity.Action.KEY_REJECTED, now));
            });
        } catch (RuntimeException ex) {
            // Never mask the provider failure the caller is in the middle of reporting.
            log.warn("[nlq-ai-settings] Could not record the key rejection for tenant {}", tenantId, ex);
        }
    }

    /**
     * Promotes an {@link KeyState#UNVERIFIED} key to {@link KeyState#VERIFIED} on a successful live
     * call, and clears a stale {@link KeyState#REJECTED} when the key evidently works again.
     *
     * <p>This is what makes the "saved during a provider outage" state self-healing: the tenant
     * does not have to come back and re-test anything, the first successful question does it.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markVerified(UUID tenantId) {
        try {
            settingsRepository.findByTenantId(tenantId).ifPresent(settings -> {
                if (settings.getKeyState() == KeyState.VERIFIED) {
                    return; // Steady state — the overwhelmingly common case. No write.
                }
                settings.markVerified(Instant.now());
                settingsRepository.save(settings);
            });
        } catch (RuntimeException ex) {
            log.warn("[nlq-ai-settings] Could not record the key verification for tenant {}", tenantId, ex);
        }
    }
}
