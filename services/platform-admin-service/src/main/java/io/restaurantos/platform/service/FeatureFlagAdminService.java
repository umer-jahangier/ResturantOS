package io.restaurantos.platform.service;

import io.restaurantos.platform.dto.PlatformDtos.FeatureSource;
import io.restaurantos.platform.dto.PlatformDtos.FeatureState;
import io.restaurantos.platform.entity.TenantFeatureEntity;
import io.restaurantos.platform.repository.TenantFeatureRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Feature-flag management with dual-key Redis invalidation (PLATFORM-04 / SC6).
 *
 * Two Redis key shapes must be invalidated atomically when a flag is toggled:
 *   1. Gateway shape (03-01):   tenant_features:{tenantId}:{featureCode}
 *   2. Aspect/service shape:    feature:{tenantId}:{featureCode}
 *
 * Both keys are deleted on write so the next read-through from any consumer
 * will re-populate from the DB source of truth.
 */
@Service
public class FeatureFlagAdminService {

    private static final Logger log = LoggerFactory.getLogger(FeatureFlagAdminService.class);

    private final TenantFeatureRepository featureRepository;
    private final StringRedisTemplate redis;

    public FeatureFlagAdminService(TenantFeatureRepository featureRepository,
                                   StringRedisTemplate redis) {
        this.featureRepository = featureRepository;
        this.redis = redis;
    }

    /**
     * Returns all features for a tenant as a map of featureCode → enabled.
     */
    public Map<String, Boolean> getFeatures(UUID tenantId) {
        return featureRepository.findByTenantId(tenantId).stream()
            .collect(Collectors.toMap(
                TenantFeatureEntity::getFeatureCode,
                TenantFeatureEntity::isEnabled
            ));
    }

    /**
     * The same flags as {@link #getFeatures(UUID)}, plus the one fact that method structurally
     * cannot carry: whether each value is a tier default or a decision somebody made.
     *
     * <p><b>Why this exists (19c).</b> {@code getFeatures} returns {@code Map<String,Boolean>}, so
     * on the wire {@code "FEATURE_CRM": false} — deliberately revoked by an operator on
     * control-bistro — is byte-identical to {@code "FEATURE_ANALYTICS": false}, which is merely
     * absent from the STARTER tier. Four rows in this database carry {@code is_override = true} and
     * every client was blind to all four. 13-14 added the column precisely so
     * {@link #reconcileToTierDefaults} would not undo deliberate settings, and that logic reads it
     * correctly — but a console cannot show an operator which of their modules will survive the
     * next tier change if the API refuses to tell it which ones it is protecting.
     *
     * <p>{@code getFeatures} is left alone rather than widened. Its callers are the gateway's
     * fallback path, {@code FeatureFlagPublicController} and three integration assertions; none of
     * them wants this, and an enforcement path is the wrong place to absorb a console's needs.
     *
     * <p>Codes present in {@code defaults} but absent from {@code tenant_features} are reported as
     * {@link FeatureSource#UNSEEDED} rather than omitted. Omitting them would make a tenant
     * provisioned before a code existed look like a tenant that has that code switched off, and
     * those two states behave differently on the next tier change — the second is skipped only if
     * marked, the first is created.
     *
     * @param defaults the CURRENT tier's matrix, from {@code TierFeatureDefaults.defaultsFor}
     * @return one entry per known code, ordered by code so the screen does not reshuffle on refetch
     */
    public List<FeatureState> getFeatureStates(UUID tenantId, Map<String, Boolean> defaults) {
        Map<String, TenantFeatureEntity> rows = featureRepository.findByTenantId(tenantId).stream()
            .collect(Collectors.toMap(TenantFeatureEntity::getFeatureCode, f -> f, (a, b) -> a));

        // Union of both sides. A row for a code the tier matrix has since dropped is still real and
        // still enforced by the gateway, so hiding it would hide a live grant.
        Set<String> codes = new TreeSet<>(defaults.keySet());
        codes.addAll(rows.keySet());

        List<FeatureState> states = new ArrayList<>(codes.size());
        for (String code : codes) {
            boolean tierDefault = Boolean.TRUE.equals(defaults.get(code));
            TenantFeatureEntity row = rows.get(code);

            if (row == null) {
                // No row: the gateway reads a cache/DB miss as disabled, so this reports as off
                // regardless of what the tier would grant. Saying otherwise would describe an
                // entitlement the tenant does not currently have.
                states.add(new FeatureState(code, false, tierDefault, false, FeatureSource.UNSEEDED));
                continue;
            }

            boolean enabled = row.isEnabled();
            FeatureSource source;
            if (!row.isOverride()) {
                source = FeatureSource.TIER_DEFAULT;
            } else if (enabled == tierDefault) {
                source = FeatureSource.OVERRIDE_MATCHES_TIER;
            } else if (enabled) {
                source = FeatureSource.OVERRIDE_GRANT;
            } else {
                source = FeatureSource.OVERRIDE_REVOKE;
            }
            states.add(new FeatureState(code, enabled, tierDefault, row.isOverride(), source));
        }
        return List.copyOf(states);
    }

    /**
     * Drop a SuperAdmin override and put the row back under tier control.
     *
     * <p>The revert control UI-SPEC §7.5 requires ("an explicit override renders solid with an
     * 'Overridden' chip and a revert control"). Clearing the marker is not cosmetic: it is the
     * difference between a row reconciliation will move on the next tier change and one it will
     * skip forever. There is no other way back — {@link #setFeature} sets the marker on every call,
     * by design, so an operator toggling a flag twice cannot accidentally un-mark it.
     *
     * <p>The value is reset to the tier default in the same transaction, because leaving the value
     * where the override put it while claiming the row is "inherited" would be a lie the very next
     * read exposes. Both Redis key shapes are re-written when the value actually moves — through
     * the same private helper the other two writers use, so no path can update one shape and leave
     * the other serving the previous answer.
     *
     * @return the value the row now holds (the tier default)
     */
    @Transactional
    public boolean clearOverride(UUID tenantId, String featureCode, boolean tierDefault) {
        TenantFeatureEntity row = featureRepository
            .findByTenantIdAndFeatureCode(tenantId, featureCode)
            .orElseThrow(() -> new IllegalArgumentException(
                "No feature row for tenant=" + tenantId + " code=" + featureCode
                    + " — there is no override to clear"));

        boolean valueMoved = row.isEnabled() != tierDefault;
        row.setEnabled(tierDefault);
        row.setOverride(false);
        featureRepository.save(row);

        if (valueMoved) {
            invalidateBothKeyShapes(tenantId, featureCode, tierDefault);
        }
        log.info("[feature-flag] tenant={} feature={} override CLEARED — back to the tier default "
            + "of {} (value {}moved)", tenantId, featureCode, tierDefault, valueMoved ? "" : "un");
        return tierDefault;
    }

    /**
     * Toggle a feature and immediately invalidate both Redis key shapes.
     * Called by SuperAdmin via PATCH /api/v1/platform/tenants/{tenantId}/features/{code}
     * and also by gateway /internal/platform/tenants/{tenantId}/features/{code}.
     *
     * <p><b>Every call through here marks the row as an override</b> (13-14). This method is only
     * ever reached from the two SuperAdmin-facing endpoints above, so an administrator touching a
     * flag is by definition making a deliberate decision — and PLATFORM-10 says that decision
     * outranks the tier default. Marking it is what lets
     * {@link #reconcileToTierDefaults(UUID, Map)} leave it alone on a later tier change instead of
     * quietly undoing it. Tier-seeded rows are written directly through the repository by
     * {@code ProvisioningService} and by the reconciler below, neither of which sets the marker.
     */
    @Transactional
    public boolean setFeature(UUID tenantId, String featureCode, boolean enabled) {
        TenantFeatureEntity feature = featureRepository
            .findByTenantIdAndFeatureCode(tenantId, featureCode)
            .orElseGet(() -> {
                TenantFeatureEntity f = new TenantFeatureEntity();
                f.setTenantId(tenantId);
                f.setFeatureCode(featureCode);
                return f;
            });
        feature.setEnabled(enabled);
        feature.setOverride(true);
        featureRepository.save(feature);

        // Dual-key SET: write both Redis key shapes synchronously (SC6 mandate)
        invalidateBothKeyShapes(tenantId, featureCode, enabled);

        log.info("[feature-flag] tenant={} feature={} enabled={} override=true — Redis invalidated",
            tenantId, featureCode, enabled);
        return enabled;
    }

    /**
     * Bring a tenant's feature rows into line with a tier's defaults, and report which codes
     * actually moved.
     *
     * <p>This is the qualitative half of a tier change (13-14 / PLATFORM-03). Codes the new tier
     * unlocks become enabled; codes it no longer covers become disabled; a code the tenant has no
     * row for at all gets one, which also backfills tenants provisioned before a code existed.
     *
     * <p><b>Rows marked {@code is_override} are skipped, in BOTH directions.</b> That is
     * PLATFORM-10 stated as code: an enterprise-only feature a SuperAdmin granted to a starter
     * tenant survives a downgrade, and a module a SuperAdmin deliberately switched OFF is not
     * switched back on by an upgrade. Skipping only the first direction would be the more tempting
     * half-measure and would silently re-enable something an administrator turned off for a reason.
     *
     * <p>Cache invalidation goes through {@link #invalidateBothKeyShapes}, the same private path
     * {@link #setFeature} uses — deliberately not reimplemented. Writing one of the two key shapes
     * leaves the other serving the previous answer, which is indistinguishable from a tier change
     * that did not take effect. Only codes whose stored value CHANGED are re-written, so an
     * upgrade does not churn twenty keys to alter three.
     *
     * <p>Nothing is deleted. A disabled feature keeps its row and every record the module owns
     * elsewhere; disabling gates access at the gateway (403 FEATURE_DISABLED) and nothing more, so
     * re-enabling restores the tenant exactly.
     *
     * @param defaults the target tier's full code→enabled map, from
     *                 {@link io.restaurantos.platform.config.TierFeatureDefaults#defaultsFor(String)}
     * @return the codes whose enabled state changed, in iteration order; empty when nothing moved
     */
    @Transactional
    public List<String> reconcileToTierDefaults(UUID tenantId, Map<String, Boolean> defaults) {
        Map<String, TenantFeatureEntity> existing = featureRepository.findByTenantId(tenantId).stream()
            .collect(Collectors.toMap(TenantFeatureEntity::getFeatureCode, f -> f, (a, b) -> a));

        List<String> changed = new ArrayList<>();
        List<TenantFeatureEntity> toSave = new ArrayList<>();

        for (Map.Entry<String, Boolean> entry : defaults.entrySet()) {
            String code = entry.getKey();
            boolean target = Boolean.TRUE.equals(entry.getValue());
            TenantFeatureEntity row = existing.get(code);

            if (row != null && row.isOverride()) {
                log.info("[feature-flag] tenant={} feature={} left at {} — SuperAdmin override is "
                    + "authoritative over the tier default of {} (PLATFORM-10)",
                    tenantId, code, row.isEnabled(), target);
                continue;
            }
            if (row == null) {
                row = new TenantFeatureEntity();
                row.setTenantId(tenantId);
                row.setFeatureCode(code);
                row.setEnabled(target);
                toSave.add(row);
                changed.add(code);
                continue;
            }
            if (row.isEnabled() != target) {
                row.setEnabled(target);
                toSave.add(row);
                changed.add(code);
            }
        }

        featureRepository.saveAll(toSave);
        for (String code : changed) {
            invalidateBothKeyShapes(tenantId, code, Boolean.TRUE.equals(defaults.get(code)));
        }
        log.info("[feature-flag] tenant={} reconciled to tier defaults — {} code(s) changed: {}",
            tenantId, changed.size(), changed);
        return List.copyOf(changed);
    }

    /**
     * Invalidate all feature flag entries for a tenant (used on tenant suspension/cancellation).
     */
    @Transactional
    public void invalidateAll(UUID tenantId) {
        featureRepository.findByTenantId(tenantId).forEach(f ->
            invalidateBothKeyShapes(tenantId, f.getFeatureCode(), f.isEnabled())
        );
        log.info("[feature-flag] All Redis cache entries invalidated for tenant={}", tenantId);
    }

    // --- Private helpers ---

    private void invalidateBothKeyShapes(UUID tenantId, String featureCode, boolean enabled) {
        String value = enabled ? "true" : "false";
        // Gateway key shape (03-01 SUMMARY §Redis keys)
        String gatewayKey  = "tenant_features:" + tenantId + ":" + featureCode;
        // Aspect / service key shape (shared-lib RedisFeatureFlagService)
        String serviceKey  = "feature:" + tenantId + ":" + featureCode;

        // SET (not DELETE) the actual new value so the gateway and @RequiresFeature aspect see the change
        // immediately on the next request. DELETE would cause RedisFeatureFlagService to fail-close to "false"
        // on cache miss, silently disabling the feature until TTL expiry (SC6 violation).
        redis.opsForValue().set(gatewayKey, value);
        redis.opsForValue().set(serviceKey, value);
    }
}
