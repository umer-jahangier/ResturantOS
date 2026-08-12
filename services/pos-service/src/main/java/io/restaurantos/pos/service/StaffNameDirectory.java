package io.restaurantos.pos.service;

import io.restaurantos.pos.feign.AuthUserDirectoryClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A user id to a human name, cached, and never a reason for a screen to fail.
 *
 * <h2>Why this exists as its own bean</h2>
 *
 * <p>Order Management prints TWO people per row and they are frequently different people: the
 * cashier who took the check, and — on a voided or refunded row — the person who settled it.
 * Measured live on 2026-08-12, {@code ORD-20260812-0166} was rung by
 * {@code bc0d9897-…} (Shift Cashier 984155) and voided by {@code fefd7187-…} (Terrace Manager).
 *
 * <p>{@link OrderSettlementDetailService} already resolved the second one and held its own private
 * TTL cache to do it. The Server/Cashier column needed exactly the same lookup, and copying that
 * cache would have meant two caches asking auth-service for the same three people on the same page
 * render. The cache is the shared thing, so the cache is what moved here.
 *
 * <h2>Fail-soft, always</h2>
 *
 * <p>A name is decoration; the id is the fact. Every failure here returns {@code null} and is
 * logged, so an auth-service outage costs a name and never a manager's order list. Callers are
 * expected to fall back to the id — never to a blank, which reads as "nobody".
 */
@Service
public class StaffNameDirectory {

    private static final Logger log = LoggerFactory.getLogger(StaffNameDirectory.class);

    /**
     * Display names change about as often as someone gets married. A short TTL keeps a manager
     * paging through orders from re-asking auth-service for the same three people on every
     * refetch, while still picking up a rename within the shift.
     */
    private static final Duration NAME_TTL = Duration.ofMinutes(5);

    private final AuthUserDirectoryClient authUserDirectoryClient;

    /**
     * Keyed by tenant AND user, never by user alone: two tenants must never be able to read each
     * other's staff names out of one process's memory.
     */
    private final Map<String, CachedName> nameCache = new ConcurrentHashMap<>();

    public StaffNameDirectory(AuthUserDirectoryClient authUserDirectoryClient) {
        this.authUserDirectoryClient = authUserDirectoryClient;
    }

    /** The display name for one user, or null when it cannot be resolved. Never throws. */
    public String resolve(UUID tenantId, UUID userId) {
        if (tenantId == null || userId == null) {
            return null;
        }
        String key = tenantId + ":" + userId;
        CachedName cached = nameCache.get(key);
        if (cached != null && cached.isFresh()) {
            return cached.name();
        }
        try {
            String name = authUserDirectoryClient.getUser(userId, tenantId).displayName();
            nameCache.put(key, new CachedName(name, Instant.now()));
            return name;
        } catch (Exception e) {
            log.warn("Could not resolve display name for user {} (tenant {}): {}",
                    userId, tenantId, e.toString());
            return null;
        }
    }

    /**
     * Names for a whole page's worth of DISTINCT ids, in one pass.
     *
     * <p>The de-duplication is the point: a page of twenty checks rung by one cashier is one
     * lookup, not twenty. Entries whose name could not be resolved are simply absent from the
     * returned map — the caller falls back to the id.
     */
    public Map<UUID, String> resolveAll(UUID tenantId, Collection<UUID> userIds) {
        Map<UUID, String> byId = new HashMap<>();
        if (tenantId == null || userIds == null) {
            return byId;
        }
        for (UUID userId : userIds) {
            if (userId == null || byId.containsKey(userId)) {
                continue;
            }
            String name = resolve(tenantId, userId);
            if (name != null && !name.isBlank()) {
                byId.put(userId, name);
            }
        }
        return byId;
    }

    private record CachedName(String name, Instant fetchedAt) {
        boolean isFresh() {
            return fetchedAt.isAfter(Instant.now().minus(NAME_TTL));
        }
    }
}
