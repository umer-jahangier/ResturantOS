package io.restaurantos.nlq.allowlist;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Role-scoped SQL table allowlist for the NLQ validator's Stage 3 (see plan 12-04, resolving
 * 12-RESEARCH Open Question 4).
 *
 * <p>Source of truth is nlq-service's own Postgres ({@code nlq_db.nlq_allowed_tables}), a
 * PLATFORM-level table keyed by role (not tenant). Redis-cached with a 10-minute TTL. A Redis
 * outage (or cache miss) always falls through to Postgres — it NEVER falls back to "allow
 * everything", and a failed lookup is never cached as if it were a real (possibly empty) answer.
 */
@Service
public class AllowedTableService {

    private static final Logger log = LoggerFactory.getLogger(AllowedTableService.class);
    private static final Duration TTL = Duration.ofMinutes(10);
    private static final String KEY_PREFIX = "nlq:allowed-tables:";
    /** Redis has no way to cache "an empty set" vs. "no entry" with a plain String value — use a marker. */
    private static final String EMPTY_MARKER = "__EMPTY__";

    private final AllowedTableRepository repository;
    private final StringRedisTemplate redis;

    public AllowedTableService(AllowedTableRepository repository, StringRedisTemplate redis) {
        this.repository = repository;
        this.redis = redis;
    }

    /**
     * @param roleCode e.g. {@code MANAGER}, {@code ACCOUNTANT} — see {@code role_permissions} in
     *                 auth-service. Never {@code null}.
     * @return the set of (normalised, lower-case, unqualified) table names this role may query.
     *         An empty set is a valid, deliberate answer (e.g. CASHIER/KITCHEN_STAFF) — the
     *         caller of this service must reject every query in that case, not treat it as "no
     *         restriction configured".
     */
    public Set<String> allowedFor(String roleCode) {
        String key = KEY_PREFIX + roleCode;

        if (redis != null) {
            try {
                String cached = redis.opsForValue().get(key);
                if (cached != null) {
                    return parse(cached);
                }
            } catch (RuntimeException ex) {
                log.warn("[nlq-allowlist] Redis lookup failed for role={} — falling through to Postgres",
                        roleCode, ex);
            }
        }

        Set<String> fromDb = queryDb(roleCode);

        if (redis != null) {
            try {
                redis.opsForValue().set(key, serialize(fromDb), TTL);
            } catch (RuntimeException ex) {
                log.warn("[nlq-allowlist] Redis write failed for role={} — result not cached", roleCode, ex);
            }
        }

        return fromDb;
    }

    private Set<String> queryDb(String roleCode) {
        return repository.findByRoleCode(roleCode).stream()
                .map(AllowedTableEntity::getTableName)
                .collect(Collectors.toUnmodifiableSet());
    }

    private static String serialize(Set<String> tables) {
        return tables.isEmpty() ? EMPTY_MARKER : String.join(",", tables);
    }

    private static Set<String> parse(String cached) {
        if (EMPTY_MARKER.equals(cached) || cached.isBlank()) {
            return Set.of();
        }
        return Set.of(cached.split(","));
    }
}
