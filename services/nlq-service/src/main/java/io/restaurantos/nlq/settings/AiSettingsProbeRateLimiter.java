package io.restaurantos.nlq.settings;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Caps how often a tenant may trigger the save-time provider probe.
 *
 * <h3>Why a rate limit on a settings screen at all</h3>
 *
 * <p>The probe is an <b>outbound HTTP request driven by tenant-supplied input</b> — the only one
 * in this service. Unlimited, it is two things it was never meant to be: an egress oracle (does
 * this key work? does this host answer?) and a credential-stuffing harness against the provider,
 * run from the platform's IP reputation rather than the attacker's.
 *
 * <p>Ten per hour is far above any honest use — an owner pastes a key once, maybe twice if they
 * fat-fingered it — and far below useful for either abuse.
 *
 * <h3>Fails OPEN, unlike the query quota</h3>
 *
 * <p>{@code NlqQuotaService} fails closed when Redis is down because an unmetered LLM endpoint is
 * a billing incident. The trade here is the opposite: this limiter guards an abuse ceiling, not a
 * spend, and failing closed would mean a Redis blip locks an owner out of the screen that fixes
 * their broken key — while the save path's real protections (permission check, encryption, the
 * provider's own auth) are all still in force.
 */
@Component
public class AiSettingsProbeRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(AiSettingsProbeRateLimiter.class);
    private static final String KEY_PREFIX = "nlq_ai_settings_probe:";
    private static final long WINDOW_SECONDS = TimeUnit.HOURS.toSeconds(1);

    private final StringRedisTemplate redis;
    private final long hourlyLimit;

    public AiSettingsProbeRateLimiter(
            StringRedisTemplate redis,
            @Value("${restaurantos.nlq.ai-settings-probe-hourly-limit:10}") long hourlyLimit) {
        this.redis = redis;
        this.hourlyLimit = hourlyLimit;
    }

    /** @throws AiSettingsProbeRateLimitedException when this tenant is over its hourly allowance. */
    public void consume(UUID tenantId) {
        String key = KEY_PREFIX + tenantId;
        long count;
        try {
            Long incremented = redis.opsForValue().increment(key);
            count = incremented == null ? 1L : incremented;
            if (count == 1L) {
                redis.expire(key, WINDOW_SECONDS, TimeUnit.SECONDS);
            }
        } catch (RuntimeException ex) {
            log.warn("[nlq-ai-settings] Probe rate limiter unavailable — allowing the save. "
                    + "See this class's javadoc for why this one fails open.", ex);
            return;
        }
        if (count > hourlyLimit) {
            throw new AiSettingsProbeRateLimitedException(hourlyLimit);
        }
    }
}
