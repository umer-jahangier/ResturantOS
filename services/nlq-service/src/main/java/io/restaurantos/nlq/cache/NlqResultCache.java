package io.restaurantos.nlq.cache;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.nlq.validation.QueryContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * The 60-second NLQ result cache ({@code restaurantos.nlq.cache-ttl-seconds}). A cache hit skips
 * BOTH the Claude call and the ClickHouse execution.
 *
 * <p><b>The tenant AND role (AND branch, for non-OWNERs) MUST be in the key.</b> A cache keyed on
 * the question alone would serve tenant A's revenue to tenant B, and a cross-branch OWNER result
 * to a branch-pinned CASHIER — turning the cache into a bypass for the very isolation
 * {@code SqlValidationPipeline} enforces. This is exactly the class of bug the 12-07 plan calls
 * out by name ("cache-poisoning cross-tenant test"), so every scoping field on
 * {@link QueryContext} that affects the result (tenant, role, branch for non-OWNERs) is hashed
 * into the key. OWNER callers are deliberately cross-branch (their branchId may be null and is
 * irrelevant to their result scope), so branchId is included for non-OWNERs only.
 */
@Component
public class NlqResultCache {

    private static final Logger log = LoggerFactory.getLogger(NlqResultCache.class);
    private static final String KEY_PREFIX = "nlq:result:";

    private final StringRedisTemplate redis;
    // USE_LONG_FOR_INTS: ClickHouse returns Int64 columns (paisa, counts) as java.lang.Long. Default
    // Jackson deserializes JSON integers as Integer, so a cache hit would return Integer where a
    // fresh result returns Long — the same value but a different boxed type, breaking the invariant
    // that a cache hit is byte-identical to the fresh result it replaced. Reading integers as Long
    // keeps the two paths consistent.
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.USE_LONG_FOR_INTS, true);
    private final Duration ttl;

    public NlqResultCache(StringRedisTemplate redis,
                           @Value("${restaurantos.nlq.cache-ttl-seconds}") long ttlSeconds) {
        this.redis = redis;
        this.ttl = Duration.ofSeconds(ttlSeconds);
    }

    public String keyFor(QueryContext ctx, String question) {
        String scopeSuffix = ctx.isOwner() ? "owner" : String.valueOf(ctx.branchId());
        String normalisedQuestion = question.trim().toLowerCase(Locale.ROOT);
        String hash = sha256(normalisedQuestion);
        return KEY_PREFIX + ctx.tenantId() + ":" + ctx.roleCode() + ":" + scopeSuffix + ":" + hash;
    }

    @SuppressWarnings("unchecked")
    public Optional<CachedResult> get(String key) {
        try {
            String json = redis.opsForValue().get(key);
            if (json == null) {
                return Optional.empty();
            }
            Map<String, Object> raw = objectMapper.readValue(json, Map.class);
            List<Map<String, Object>> rows = (List<Map<String, Object>>) raw.get("rows");
            String executedSql = (String) raw.get("executedSql");
            String narrative = (String) raw.get("narrative");
            return Optional.of(new CachedResult(rows, executedSql, narrative));
        } catch (Exception ex) {
            log.warn("[nlq-cache] Cache read failed — treating as a miss", ex);
            return Optional.empty();
        }
    }

    public void put(String key, CachedResult result) {
        try {
            Map<String, Object> raw = Map.of(
                    "rows", result.rows(),
                    "executedSql", result.executedSql(),
                    "narrative", result.narrative() == null ? "" : result.narrative());
            redis.opsForValue().set(key, objectMapper.writeValueAsString(raw), ttl);
        } catch (Exception ex) {
            log.warn("[nlq-cache] Cache write failed — result served but not cached", ex);
        }
    }

    private static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }

    public record CachedResult(List<Map<String, Object>> rows, String executedSql, String narrative) {
    }
}
