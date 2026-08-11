package io.restaurantos.gateway;

import io.restaurantos.gateway.config.RateLimitConfig;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;

import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * ADMS-REG-03 — the shared rate-limit bucket, which was a cross-tenant denial-of-service hole rather
 * than a tuning issue.
 *
 * <h2>What was wrong</h2>
 *
 * <p>{@code deviceKeyResolver} read the serial from the {@code SN} <b>query parameter</b> and fell
 * back to the literal string {@code "unknown"}. The ADMS/iClock protocol carries {@code SN} on every
 * call, so {@code /iclock} keyed correctly. But {@code /internal/attendance/ingest} — the JSON bridge
 * route, wired to the same resolver — carries its serial in the <b>body</b>, so it always missed and
 * always took the fallback. Because that fallback was a constant, <b>every bridge agent in every
 * tenant on the platform shared one 120-request bucket</b>: any one tenant's terminals could starve
 * every other tenant's, and a single misconfigured device retrying in a loop denied service
 * platform-wide.
 *
 * <h2>What these tests assert</h2>
 *
 * <p>Not "the key is non-null" — the broken version returned a non-null key too, and that is exactly
 * why it survived review. <b>The assertion is that two callers cannot land in the same bucket</b>,
 * across every combination of inputs the two device routes can produce, including the one where a
 * caller supplies no serial at all.
 */
class DeviceRateLimitKeyTest {

    private final KeyResolver resolver = new RateLimitConfig().deviceKeyResolver();

    private String keyFor(MockServerHttpRequest request) {
        return resolver.resolve(MockServerWebExchange.from(request)).block();
    }

    /** A network terminal: serial in the query string, as the ADMS protocol sends it. */
    private String terminalKey(String serial, String sourceIp) {
        return keyFor(MockServerHttpRequest.get("/iclock/cdata?SN=" + serial + "&table=ATTLOG")
                .header("X-Forwarded-For", sourceIp).build());
    }

    /** A bridge agent: serial in a header, because its body is JSON and we write the client. */
    private String bridgeKey(String serial, String sourceIp) {
        return keyFor(MockServerHttpRequest.post("/internal/attendance/ingest")
                .header("X-Device-Serial", serial)
                .header("X-Forwarded-For", sourceIp).build());
    }

    @Test
    void twoBridgeAgentsInDifferentTenantsGetSeparateBuckets() {
        String tenantA = bridgeKey("SN-TENANT-A-001", "203.0.113.10");
        String tenantB = bridgeKey("SN-TENANT-B-001", "198.51.100.20");

        assertThat(tenantA)
                .as("one tenant's bridge agent must not be able to exhaust another's budget")
                .isNotEqualTo(tenantB);
    }

    @Test
    void twoBridgeAgentsBehindTheSamePublicAddressStillGetSeparateBuckets() {
        // Two branches of one chain behind one NAT, or two tenants on one shared office connection.
        // Keying on the address alone would merge them; keying on the serial does not.
        String first = bridgeKey("SN-BRANCH-1", "203.0.113.10");
        String second = bridgeKey("SN-BRANCH-2", "203.0.113.10");

        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void aCallerSendingNoSerialAtAllIsIsolatedToItsOwnAddressAndNotToASharedConstant() {
        MockServerHttpRequest noSerialA = MockServerHttpRequest.post("/internal/attendance/ingest")
                .header("X-Forwarded-For", "203.0.113.10").build();
        MockServerHttpRequest noSerialB = MockServerHttpRequest.post("/internal/attendance/ingest")
                .header("X-Forwarded-For", "198.51.100.20").build();

        String a = keyFor(noSerialA);
        String b = keyFor(noSerialB);

        assertThat(a)
                .as("the regression: a constant fallback is one bucket for the whole platform")
                .isNotEqualTo(b);
        assertThat(a).doesNotContain("unknown");
        assertThat(b).doesNotContain("unknown");
    }

    @Test
    void theTerminalRouteStillKeysOnTheSerialItAlreadySent() {
        assertThat(terminalKey("SN-TERMINAL-1", "203.0.113.10"))
                .isNotEqualTo(terminalKey("SN-TERMINAL-2", "203.0.113.10"));
    }

    /**
     * A terminal and a bridge agent carrying the same serial are the same device on two paths, and
     * must therefore share one budget — otherwise a device could double its allowance by alternating.
     */
    @Test
    void oneDeviceOnBothRoutesSharesASingleBudget() {
        assertThat(bridgeKey("SN-SAME-DEVICE", "203.0.113.10"))
                .isEqualTo(terminalKey("SN-SAME-DEVICE", "198.51.100.20"));
    }

    /**
     * The property stated once, over every shape of request the two routes accept: no two distinct
     * callers collide. The broken resolver failed this on three of the five.
     */
    @Test
    void acrossEveryInputShapeNoTwoDistinctCallersShareAKey() {
        Set<String> keys = new HashSet<>();
        keys.add(bridgeKey("SN-A", "203.0.113.1"));
        keys.add(bridgeKey("SN-B", "203.0.113.1"));
        keys.add(terminalKey("SN-C", "203.0.113.1"));
        keys.add(keyFor(MockServerHttpRequest.post("/internal/attendance/ingest")
                .header("X-Forwarded-For", "203.0.113.2").build()));
        keys.add(keyFor(MockServerHttpRequest.post("/internal/attendance/ingest")
                .header("X-Forwarded-For", "203.0.113.3").build()));

        assertThat(keys).as("five distinct callers, five distinct buckets").hasSize(5);
    }
}
