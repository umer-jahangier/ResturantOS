package io.restaurantos.gateway;

import io.restaurantos.gateway.support.RouteFeatureMap;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A quota-exhausted tenant must still be able to reach the screen that fixes their AI key.
 *
 * <h3>The trap this closes</h3>
 *
 * <p>{@code isQuotaBearing} used to be {@code path.startsWith("/api/v1/nlq/")}. That was harmless
 * only because {@code /api/v1/nlq/query} was the sole endpoint beneath it. Program C adds
 * {@code /api/v1/nlq/settings/ai} — where a tenant supplies their OWN API key — and
 * {@code FeatureFlagGlobalFilter.checkQuota} returns <b>429 QUOTA_EXCEEDED</b> once
 * {@code nlq_quota:{tenant}:monthly_count} crosses the limit. Under the old prefix:
 *
 * <blockquote>a tenant who had burned their monthly NLQ allowance would be locked out of the very
 * screen whose purpose is to stop them consuming the platform's allowance.</blockquote>
 *
 * <p>A quota is a spend cap on generated queries. Reading or changing configuration spends nothing.
 *
 * <p>This is a plain unit test rather than another case in {@code FeatureFlagFilterIT} on purpose:
 * the mapping is a pure function, and a test that needs Redis and a running gateway to assert a
 * {@code startsWith} would be slower, flakier, and no more convincing.
 */
class RouteFeatureMapQuotaScopeTest {

    private final RouteFeatureMap map = new RouteFeatureMap();

    @Test
    @DisplayName("the NLQ query path IS quota-bearing — the positive control")
    void queryPathIsQuotaBearing() {
        // Without this, narrowing the prefix all the way to "never" would pass the test below.
        assertThat(map.isQuotaBearing("/api/v1/nlq/query")).isTrue();
    }

    @Test
    @DisplayName("the AI settings path is NOT quota-bearing")
    void settingsPathIsNotQuotaBearing() {
        assertThat(map.isQuotaBearing("/api/v1/nlq/settings/ai"))
                .as("""
                    /api/v1/nlq/settings/ai must not consume the NLQ quota. If this is true, \
                    RouteFeatureMap.isQuotaBearing has been widened back to the bare "/api/v1/nlq/" \
                    prefix, and a tenant who has exhausted their monthly allowance gets a 429 on the \
                    screen where they would install their own API key — the one action that stops \
                    them spending the platform's allowance at all.""")
                .isFalse();
    }

    @Test
    @DisplayName("the FEATURE_NLQ gate still applies to the settings path — only the QUOTA narrowed")
    void settingsPathIsStillFeatureGated() {
        // The narrowing must not have taken the feature flag with it: a tenant without the NLQ
        // feature has no business configuring it.
        assertThat(map.featureFor("/api/v1/nlq/settings/ai")).contains("FEATURE_NLQ");
        assertThat(map.featureFor("/api/v1/nlq/query")).contains("FEATURE_NLQ");
    }

    @Test
    @DisplayName("unrelated paths are unaffected")
    void unrelatedPathsAreNotQuotaBearing() {
        assertThat(map.isQuotaBearing("/api/v1/pos/orders")).isFalse();
        assertThat(map.isQuotaBearing("/api/v1/auth/login")).isFalse();
    }
}
