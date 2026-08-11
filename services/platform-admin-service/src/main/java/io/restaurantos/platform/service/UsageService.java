package io.restaurantos.platform.service;

import io.restaurantos.platform.client.UserInternalClient;
import io.restaurantos.platform.config.TierLimits;
import io.restaurantos.platform.dto.PlatformDtos.TenantUsageResponse;
import io.restaurantos.platform.dto.PlatformDtos.UsageMeter;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.entity.UsageRecordEntity;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.platform.repository.UsageRecordRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Usage telemetry (PLATFORM-06) and the read side of usage-against-entitlement (19c).
 *
 * <h3>What is actually metered, as of this plan</h3>
 *
 * Almost nothing, and this class says so rather than papering over it. Measured live before the
 * read endpoint was written:
 *
 * <pre>
 *   select count(*) from usage_records;                  -> 0
 *   redis-cli --scan --pattern 'nlq_quota:*' | wc -l     -> 0
 * </pre>
 *
 * Zero rows, and per the audit zero producers: grepping for {@code /internal/platform} finds
 * consumers of {@code /status}, {@code /features}, {@code /auth/verify} and {@code /slug} and no
 * consumer of {@code /usage} at all. The endpoint below therefore reports only what is genuinely
 * knowable and declines to guess at the rest — see {@link #meters} for why {@code 0} and "not
 * metered" must not be the same answer.
 */
@Service
public class UsageService {

    private static final Logger log = LoggerFactory.getLogger(UsageService.class);

    /** Written by nlq-service, enforced by the gateway's {@code FeatureFlagGlobalFilter}. */
    private static final String NLQ_COUNTER_KEY = "nlq_quota:%s:monthly_count";

    private final UsageRecordRepository usageRecordRepository;
    private final TenantRepository tenantRepository;
    private final UserInternalClient userClient;
    private final TierLimits tierLimits;
    private final StringRedisTemplate redis;

    public UsageService(UsageRecordRepository usageRecordRepository,
                        TenantRepository tenantRepository,
                        UserInternalClient userClient,
                        TierLimits tierLimits,
                        StringRedisTemplate redis) {
        this.usageRecordRepository = usageRecordRepository;
        this.tenantRepository = tenantRepository;
        this.userClient = userClient;
        this.tierLimits = tierLimits;
        this.redis = redis;
    }

    /**
     * Append a usage delta and return the tenant's RUNNING TOTAL for that resource.
     *
     * <p><b>GA-051.</b> This returned {@code countByTenantIdAndResource} — the number of rows — and
     * the internal controller surfaced it as {@code newCount}, a running total. Record a delta of 5
     * and then a delta of 3 and it reported <b>2</b>. The correct aggregate,
     * {@code sumQtyByTenantIdAndResource}, already existed on the repository with zero callers; so
     * did {@link #getTotal}. A quantity and a cardinality agree only while every delta is exactly 1,
     * which is the one case a metering system does not need.
     *
     * <p>Rounded down to a whole unit on the way out. {@code qty} is a {@code BigDecimal} because a
     * resource may be fractional (gigabytes), but the wire contract is {@code long}; truncating
     * rather than rounding up means a tenant is never told they have consumed a unit they have not.
     */
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

        return getTotal(tenantId, resource);
    }

    /** The summed quantity for a resource, not the row count. Zero when nothing was recorded. */
    public long getTotal(UUID tenantId, String resource) {
        BigDecimal total = usageRecordRepository.sumQtyByTenantIdAndResource(tenantId, resource);
        return total == null ? 0L : total.longValue();
    }

    /**
     * The tier ceiling for a resource, for the internal record endpoint's response.
     *
     * <p><b>GA-052.</b> That endpoint hardcoded {@code Long.MAX_VALUE} as the {@code limit}, which
     * is the entitlement half of usage-against-entitlement being discarded at the point it was
     * about to be useful. The real ceilings sit on the tenant row, put there by {@link TierLimits}.
     *
     * <p>A resource this service has no ceiling concept for returns {@code -1}, meaning "unlimited /
     * not capped" — distinct from a real cap that happens to be large, and distinct from zero.
     */
    public long limitFor(UUID tenantId, String resource) {
        return tenantRepository.findById(tenantId)
            .map(t -> switch (resource == null ? "" : resource.toLowerCase()) {
                case "branches", "branch" -> (long) orZero(t.getMaxBranches());
                case "users", "user", "seats" -> (long) orZero(t.getMaxUsers());
                case "storage_gb", "storage" -> (long) orZero(t.getStorageGb());
                case "nlq_queries", "nlq" -> (long) orZero(t.getNlqQuota());
                default -> -1L;
            })
            .orElse(-1L);
    }

    /**
     * Usage against entitlement for one tenant.
     *
     * <h3>The three states, and why they are not one state</h3>
     *
     * The tempting implementation returns {@code used} as a number for every dimension, defaulting
     * to {@code 0}. It must not, because {@code 0} is a claim: it says "we counted, and the answer
     * was none". For three of the four dimensions below nobody is counting at all, and rendering a
     * confident {@code 0 / 500 users} for a tenant with forty staff is a fabrication an operator
     * would reasonably act on. So:
     *
     * <ul>
     *   <li><b>branches</b> — really countable. {@code GET /internal/users/tenants/{id}/branches} is
     *       the same call {@code TenantSubscriptionService.usageViolations} already trusts to refuse
     *       a downgrade, so this screen and that safety check cannot disagree. If the call fails the
     *       meter is marked {@code unavailable}, never {@code 0} — identical posture to 13-03's
     *       tenant status, where undeterminable means NOT entitled rather than "probably fine", and
     *       identical to what {@code usageViolations} does when it refuses the downgrade outright.
     *   <li><b>users</b> — not countable here, and this is a named gap rather than an oversight:
     *       {@code users} lives in auth_db and auth-service exposes no per-tenant count. The same
     *       gap is documented on {@code usageViolations}, which is why a downgrade below the user
     *       cap is applied without a refusal today.
     *   <li><b>storage_gb</b> — no meter exists anywhere. file-service records no usage.
     *   <li><b>nlq_queries</b> — a real counter shape the gateway enforces against, but nothing
     *       currently writes it (0 keys live). Absence of the key is reported as not-metered rather
     *       than as zero, because those genuinely differ: a tenant who has run no queries this
     *       month and a platform where the counter was never wired look identical at the key level.
     * </ul>
     *
     * <p>Any resource that HAS accumulated rows in {@code usage_records} is added as a counted
     * meter on top of the four above, so the day a producer appears this screen shows it without
     * another change here.
     */
    public TenantUsageResponse meters(UUID tenantId) {
        TenantEntity tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new IllegalArgumentException("Tenant not found: " + tenantId));

        List<UsageMeter> meters = new ArrayList<>();
        meters.add(branchMeter(tenantId, orZero(tenant.getMaxBranches())));
        meters.add(UsageMeter.notMetered("users", "users", orZero(tenant.getMaxUsers()),
            "auth-service exposes no per-tenant user count; the users table lives in auth_db"));
        meters.add(UsageMeter.notMetered("storage_gb", "GB", orZero(tenant.getStorageGb()),
            "no producer records storage usage — file-service emits no usage events"));
        meters.add(nlqMeter(tenantId, orZero(tenant.getNlqQuota())));

        // Anything a real producer has started recording. Empty today (usage_records has 0 rows).
        Set<String> known = Set.of("branches", "users", "storage_gb", "nlq_queries");
        for (String resource : usageRecordRepository.findDistinctResourcesByTenantId(tenantId)) {
            if (known.contains(resource)) continue;
            meters.add(UsageMeter.counted(resource, "units", getTotal(tenantId, resource),
                limitFor(tenantId, resource), "usage_records (summed qty)"));
        }

        boolean anyMetered = meters.stream().anyMatch(UsageMeter::metered);
        return new TenantUsageResponse(tenantId, tenant.getTier().name(), List.copyOf(meters), anyMetered);
    }

    /** The one dimension with a real, live count. Unreadable is refused, not defaulted to zero. */
    private UsageMeter branchMeter(UUID tenantId, long limit) {
        try {
            var branches = userClient.listBranches(tenantId);
            long used = branches == null ? 0 : branches.size();
            return UsageMeter.counted("branches", "branches", used, limit,
                "user-service live count (GET /internal/users/tenants/{id}/branches)");
        } catch (Exception ex) {
            log.warn("[usage] tenant={} branch count unavailable ({}) — reporting the meter as "
                + "UNREADABLE rather than as zero", tenantId, ex.toString());
            return UsageMeter.unreadable("branches", "branches", limit,
                "user-service did not answer (" + ex.getClass().getSimpleName() + ")");
        }
    }

    /**
     * The NLQ monthly counter the gateway throttles against.
     *
     * <p>A missing key is NOT zero. nlq-service is what increments it and nothing does today, so an
     * absent key means "unwired", while a present {@code "0"} would mean "wired, nothing used". The
     * screen is entitled to that difference.
     */
    private UsageMeter nlqMeter(UUID tenantId, long limit) {
        String raw;
        try {
            raw = redis.opsForValue().get(NLQ_COUNTER_KEY.formatted(tenantId));
        } catch (Exception ex) {
            log.warn("[usage] tenant={} nlq counter read failed ({})", tenantId, ex.toString());
            return UsageMeter.unreadable("nlq_queries", "queries", limit,
                "Redis did not answer (" + ex.getClass().getSimpleName() + ")");
        }
        if (raw == null) {
            return UsageMeter.notMetered("nlq_queries", "queries", limit,
                "no counter exists — nlq-service has never incremented "
                    + "nlq_quota:{tenantId}:monthly_count for this tenant");
        }
        try {
            return UsageMeter.counted("nlq_queries", "queries", Long.parseLong(raw.trim()), limit,
                "Redis nlq_quota:{tenantId}:monthly_count (written by nlq-service)");
        } catch (NumberFormatException ex) {
            // A corrupt counter is a broken meter, not an empty one. The gateway takes the same
            // view — it logs and refuses to treat an unparseable counter as permission.
            return UsageMeter.unreadable("nlq_queries", "queries", limit,
                "counter is not a number (" + raw + ")");
        }
    }

    private static int orZero(Integer value) {
        return value == null ? 0 : value;
    }
}
