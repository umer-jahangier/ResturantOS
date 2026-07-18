package io.restaurantos.reporting.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.reporting.dto.DashboardTileDto;
import io.restaurantos.reporting.ws.DashboardWebSocketHandler;
import io.restaurantos.reporting.ws.TilePushThrottle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Computes the branch dashboard's KPI tiles from ClickHouse facts (today's business date), caches
 * them in Redis under {@code dashboard:tiles:{tenantId}:{branchId}:{businessDate}} (short TTL —
 * M5.4's Redis-precomputed-tiles spec, and it means the REST snapshot endpoint and the WS push
 * serve the SAME numbers instead of racing each other to slightly different ones), and pushes
 * updates over the dashboard WebSocket through {@link TilePushThrottle}'s
 * leading-edge-push-plus-trailing-edge-flush contract.
 *
 * <p><b>{@code open-tills} is deliberately NOT a tile.</b> {@code till_session_facts} (12-03) is
 * populated ONLY by TILL_CLOSED — there is no fact recording a till session being OPENED, so
 * "tills currently open" is not computable from the data this service has. Rendering it as 0 would
 * be a lie an owner could act on; the tile is dropped rather than faked (see 12-06-SUMMARY.md).
 */
@Service
public class DashboardTileService {

    private static final Logger log = LoggerFactory.getLogger(DashboardTileService.class);
    private static final String CACHE_KEY_PREFIX = "dashboard:tiles:";

    private final JdbcTemplate clickHouseJdbcTemplate;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final TilePushThrottle tilePushThrottle;
    private final DashboardWebSocketHandler webSocketHandler;
    private final Duration cacheTtl;

    /**
     * Remembers the last known (tenantId, businessDate) per branchId so the scheduled
     * trailing-flush sweep ({@link #flushDueTiles()}) can recompute a branch's tiles without
     * fresh event context — the throttle only knows tile KEYS are due, not which
     * tenant/businessDate they belong to.
     */
    private final ConcurrentHashMap<UUID, BranchContext> lastContext = new ConcurrentHashMap<>();

    private record BranchContext(UUID tenantId, LocalDate businessDate) {}

    public DashboardTileService(@Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate,
                                 StringRedisTemplate redisTemplate,
                                 ObjectMapper objectMapper,
                                 TilePushThrottle tilePushThrottle,
                                 DashboardWebSocketHandler webSocketHandler,
                                 @Value("${restaurantos.dashboard.tile-cache-ttl-seconds:10}") long cacheTtlSeconds) {
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.tilePushThrottle = tilePushThrottle;
        this.webSocketHandler = webSocketHandler;
        this.cacheTtl = Duration.ofSeconds(cacheTtlSeconds);
    }

    /** Serves the REST snapshot endpoint — cache-first, so a freshly-connected client is not blank. */
    public List<DashboardTileDto> computeTiles(UUID tenantId, UUID branchId, LocalDate businessDate) {
        String cacheKey = cacheKey(tenantId, branchId, businessDate);
        List<DashboardTileDto> cached = readCache(cacheKey);
        if (cached != null) {
            return cached;
        }
        List<DashboardTileDto> tiles = queryTiles(tenantId, branchId, businessDate);
        writeCache(cacheKey, tiles);
        return tiles;
    }

    /**
     * Called by {@code OrderClosedConsumer}/{@code TillClosedConsumer} AFTER their fact write
     * succeeds. ALWAYS recomputes fresh from ClickHouse (never serves the cache) — the whole
     * point is to reflect the row that just landed. The cache is refreshed too, so the REST
     * endpoint agrees with the last WS push.
     */
    public void recomputeAndPush(UUID tenantId, UUID branchId, LocalDate businessDate) {
        lastContext.put(branchId, new BranchContext(tenantId, businessDate));
        List<DashboardTileDto> tiles = queryTiles(tenantId, branchId, businessDate);
        writeCache(cacheKey(tenantId, branchId, businessDate), tiles);
        pushIfGranted(branchId, tiles);
    }

    /**
     * The trailing-edge-flush half of the throttle contract (12-06 must_have: a throttled burst
     * must still converge within 5s). Runs every second; for any branch with a tile whose
     * throttle window has since elapsed, recomputes the TRUE current state and pushes it —
     * guaranteeing the client is never stuck on a stale value from a suppressed push.
     */
    @Scheduled(fixedDelay = 1000)
    public void flushDueTiles() {
        Set<String> dueKeys = tilePushThrottle.drainDueTileKeys();
        if (dueKeys.isEmpty()) {
            return;
        }
        Set<UUID> dueBranches = dueKeys.stream()
                .map(key -> UUID.fromString(key.substring(0, key.indexOf(':'))))
                .collect(Collectors.toSet());
        for (UUID branchId : dueBranches) {
            BranchContext ctx = lastContext.get(branchId);
            if (ctx == null) {
                continue;
            }
            List<DashboardTileDto> tiles = queryTiles(ctx.tenantId(), branchId, ctx.businessDate());
            writeCache(cacheKey(ctx.tenantId(), branchId, ctx.businessDate()), tiles);
            webSocketHandler.notifySubscribers(branchId, tiles);
        }
    }

    private void pushIfGranted(UUID branchId, List<DashboardTileDto> tiles) {
        boolean anyGranted = false;
        for (DashboardTileDto tile : tiles) {
            if (tilePushThrottle.tryAcquire(branchId + ":" + tile.tileId())) {
                anyGranted = true;
            }
        }
        if (anyGranted) {
            webSocketHandler.notifySubscribers(branchId, tiles);
        }
    }

    private List<DashboardTileDto> queryTiles(UUID tenantId, UUID branchId, LocalDate businessDate) {
        // business_date bound as a raw LocalDate — NEVER java.sql.Date.valueOf(...), which
        // clickhouse-jdbc 0.8.6 shifts back a day on a non-UTC JVM (proven in 12-05). Matches
        // SalesFactWriter's write type.
        Map<String, Object> row = clickHouseJdbcTemplate.queryForMap("""
                SELECT sum(total_paisa) AS revenue, count() AS order_count, sum(tax_paisa) AS tax
                FROM clickhouse_analytics.sales_order_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date = ?
                """, tenantId, branchId, businessDate);

        long revenue = asLong(row.get("revenue"));
        long orderCount = asLong(row.get("order_count"));
        long tax = asLong(row.get("tax"));
        // Integer paisa division; divide-by-zero guards to null (not 0 — "no orders yet" and
        // "average order value is zero" are different facts).
        Long averageOrderValue = orderCount == 0 ? null : revenue / orderCount;

        Instant now = Instant.now();
        return List.of(
                new DashboardTileDto("todays-revenue", "Today's Revenue", revenue, null, "PKR", businessDate, now),
                new DashboardTileDto("todays-orders", "Today's Orders", null, orderCount, "count", businessDate, now),
                new DashboardTileDto("todays-tax", "Today's Tax", tax, null, "PKR", businessDate, now),
                new DashboardTileDto("average-order-value", "Average Order Value", averageOrderValue, null, "PKR", businessDate, now)
        );
    }

    private long asLong(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }

    private String cacheKey(UUID tenantId, UUID branchId, LocalDate businessDate) {
        return CACHE_KEY_PREFIX + tenantId + ":" + branchId + ":" + businessDate;
    }

    private List<DashboardTileDto> readCache(String cacheKey) {
        try {
            String cached = redisTemplate.opsForValue().get(cacheKey);
            if (cached == null || cached.isBlank()) {
                return null;
            }
            return objectMapper.readValue(cached,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, DashboardTileDto.class));
        } catch (Exception e) {
            log.warn("DashboardTileService: Redis cache read failed for key={}: {}", cacheKey, e.getMessage());
            return null;
        }
    }

    private void writeCache(String cacheKey, List<DashboardTileDto> tiles) {
        try {
            redisTemplate.opsForValue().set(cacheKey, objectMapper.writeValueAsString(tiles), cacheTtl);
        } catch (Exception e) {
            log.warn("DashboardTileService: Redis cache write failed for key={}: {}", cacheKey, e.getMessage());
        }
    }
}
