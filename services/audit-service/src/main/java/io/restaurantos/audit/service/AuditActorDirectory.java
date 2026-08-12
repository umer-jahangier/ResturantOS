package io.restaurantos.audit.service;

import io.restaurantos.audit.feign.AuthUserDirectoryClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Turns the user ids on one page of audit rows into names, once each.
 *
 * <h2>Why this exists</h2>
 *
 * <p>The audit log's whole job is to answer "who did this". Before F4 the read API answered it with
 * {@code "userId": "bc0d9897-e0ef-40de-b404-89ce044ab2cb"}, which is an answer only to someone
 * holding a copy of the users table. The walkthrough's own note on the Voided list —
 * <i>"by Shift Cashier 984155"</i> — is the standard this has to meet, because that is what the
 * same event looks like one screen away.
 *
 * <h2>Fail-soft, and loudly enough to be fixed</h2>
 *
 * <p>A directory failure returns null for that id and the screen prints the id. It never throws:
 * an audit log that refuses to render because a NAME could not be fetched has substituted a
 * cosmetic dependency for its own availability, and the row — not the name — is the evidence.
 * The failure is logged at WARN once per id per TTL window rather than swallowed silently.
 *
 * <h2>One lookup per distinct id per page</h2>
 *
 * <p>A 50-row page of logins is typically three people. Resolving per row would be 50 calls for
 * three answers, on a screen that is paged through. The cache is a plain map with a short TTL —
 * the same choice, and the same five minutes, as {@code OrderSettlementDetailService}: names change
 * about as often as someone gets married, and five minutes still picks a rename up within a shift.
 *
 * <p>Keyed on (tenant, user) rather than user alone. The id is globally unique so a collision is not
 * the risk; a cache keyed on the user alone would let one tenant's lookup answer another's, which is
 * a cross-tenant read even when the answer happens to be the same string.
 */
@Service
public class AuditActorDirectory {

    private static final Logger log = LoggerFactory.getLogger(AuditActorDirectory.class);

    private static final Duration TTL = Duration.ofMinutes(5);

    private final AuthUserDirectoryClient authUserDirectoryClient;
    private final Map<String, CachedName> cache = new ConcurrentHashMap<>();

    public AuditActorDirectory(AuthUserDirectoryClient authUserDirectoryClient) {
        this.authUserDirectoryClient = authUserDirectoryClient;
    }

    /**
     * Names for every id given, as far as the directory can supply them.
     *
     * <p>An id the directory cannot resolve is simply absent from the returned map — never present
     * with a placeholder string. The caller renders the id, and "unknown" is a state the reader can
     * tell apart from a person actually called something.
     */
    public Map<UUID, String> namesFor(UUID tenantId, Collection<UUID> userIds) {
        Map<UUID, String> resolved = new HashMap<>();
        if (tenantId == null || userIds == null || userIds.isEmpty()) {
            return resolved;
        }
        Set<UUID> distinct = new LinkedHashSet<>(userIds);
        distinct.remove(null);

        for (UUID userId : distinct) {
            String name = resolve(tenantId, userId);
            if (name != null) {
                resolved.put(userId, name);
            }
        }
        return resolved;
    }

    private String resolve(UUID tenantId, UUID userId) {
        String key = tenantId + ":" + userId;
        CachedName cached = cache.get(key);
        if (cached != null && cached.isFresh()) {
            return cached.name();
        }
        String name = null;
        try {
            AuthUserDirectoryClient.UserDetailEnvelope envelope =
                    authUserDirectoryClient.getUser(userId, tenantId);
            name = envelope == null ? null : envelope.displayName();
        } catch (Exception e) {
            // Deliberately swallowed — see the class javadoc. Logged so an operator seeing a page
            // of UUIDs has something to search for rather than a screen that merely looks unhelpful.
            log.warn("Could not resolve audit actor name for user {} in tenant {}: {}",
                    userId, tenantId, e.toString());
        }
        // A miss is cached too. A deleted account is looked up once per TTL rather than on every
        // row of every page for as long as its events are in the window.
        cache.put(key, new CachedName(name, Instant.now()));
        return name;
    }

    private record CachedName(String name, Instant fetchedAt) {
        boolean isFresh() {
            return Duration.between(fetchedAt, Instant.now()).compareTo(TTL) < 0;
        }
    }
}
