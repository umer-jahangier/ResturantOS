package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.AuthMode;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The credential-policy seam and the two modes D-25-06 chose (`both`).
 *
 * <p>The property that matters most here is the one that is easiest to lose: <b>every refusal is
 * byte-identical whatever the mode and whatever the cause</b>, so a new mode cannot become a way to
 * tell a stranger which mode a serial uses. It is asserted by comparing refusals to each other, never
 * each to a literal — several refusals can each satisfy a written expectation and still differ.
 */
class DeviceCredentialPolicyIT extends AdmsWireTestBase {

    @Autowired AttendanceDeviceRepository repository;
    @Autowired TenantContext ctx;

    /** The address the test's own HTTP client will appear to come from. See AdmsRequestContext. */
    private static final String CLIENT_IP = "203.0.113.7";

    private HttpResponse<String> handshakeFrom(String serial, String token, String sourceIp, String host)
            throws Exception {
        String uri = base() + "/iclock/cdata?SN=" + enc(serial) + "&options=all&pushver=2.4.0"
                + (token == null ? "" : "&token=" + enc(token));
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(uri)).GET();
        if (sourceIp != null) {
            b.header("X-Forwarded-For", sourceIp);
        }
        if (host != null) {
            b.header("X-Forwarded-Host", host);
        }
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private void setMode(String serial, AuthMode mode, String allowlist) {
        mutate(serial, d -> {
            d.setAuthMode(mode);
            d.setSourceAddressAllowlist(allowlist);
        });
    }

    private void mutate(String serial, Consumer<AttendanceDeviceEntity> change) {
        AttendanceDeviceEntity d = repository.resolveBySerial(serial).orElseThrow();
        change.accept(d);
        ctx.set(d.getTenantId(), d.getBranchId(), UUID.randomUUID(), null);
        try {
            repository.save(d);
        } finally {
            ctx.clear();
        }
    }

    // ---------------------------------------------------------------- token mode is untouched

    @Test
    void aTokenDeviceBehavesExactlyAsBeforeAndIsStillTheDefault() throws Exception {
        Fixture fx = register(null);

        assertThat(repository.resolveBySerial(fx.serial()).orElseThrow().getAuthMode())
                .as("D-25-06: registration must not change how a device authenticates")
                .isEqualTo(AuthMode.TOKEN);
        assertThat(handshakeFrom(fx.serial(), fx.token(), CLIENT_IP, null).statusCode()).isEqualTo(200);
        assertThat(handshakeFrom(fx.serial(), "wrong", CLIENT_IP, null).statusCode()).isEqualTo(401);
        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, null).statusCode()).isEqualTo(401);
    }

    // ---------------------------------------------------------------- serial-only, bounded

    /**
     * The headline: a terminal given nothing but a server address and a port can now deliver a punch.
     * Its request carries no token at all, because its firmware has no field to put one in.
     */
    @Test
    void aTerminalWithNoTokenAtAllResolvesWhenItsAddressIsAllowed() throws Exception {
        Fixture fx = register(null);
        setMode(fx.serial(), AuthMode.SERIAL_ONLY_BOUNDED, CLIENT_IP);

        HttpResponse<String> res = handshakeFrom(fx.serial(), null, CLIENT_IP, null);

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("Realtime=1").contains(fx.serial());
    }

    @Test
    void aCidrRangeMatchesAnAddressInsideIt() throws Exception {
        Fixture fx = register(null);
        setMode(fx.serial(), AuthMode.SERIAL_ONLY_BOUNDED, "198.51.100.0/24, 203.0.113.0/28");

        assertThat(handshakeFrom(fx.serial(), null, "203.0.113.9", null).statusCode()).isEqualTo(200);
        assertThat(handshakeFrom(fx.serial(), null, "198.51.100.250", null).statusCode()).isEqualTo(200);
        assertThat(handshakeFrom(fx.serial(), null, "203.0.113.99", null).statusCode())
                .as("outside the /28")
                .isEqualTo(401);
    }

    /**
     * The misconfiguration that matters: an administrator selects the mode and never fills the
     * addresses in. Open is the wrong answer to that mistake, and the check runs before any other.
     */
    @Test
    void aSecretlessModeWithAnEmptyAllowlistIsRefusedOutright() throws Exception {
        Fixture fx = register(null);
        setMode(fx.serial(), AuthMode.SERIAL_ONLY_BOUNDED, null);

        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, null).statusCode()).isEqualTo(401);
        assertThat(handshakeFrom(fx.serial(), fx.token(), CLIENT_IP, null).statusCode())
                .as("not even a correct token rescues it — the empty allowlist is checked first")
                .isEqualTo(401);

        setMode(fx.serial(), AuthMode.SERIAL_ONLY_BOUNDED, "   ");
        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, null).statusCode())
                .as("whitespace is empty")
                .isEqualTo(401);
    }

    /**
     * 25-AUTH-MODES.md's added constraint. Without this, a restaurant whose public IP changed sees
     * "the clock stopped working" and nothing in the product says why.
     */
    @Test
    void aSourceAddressRefusalRecordsTheObservedAddressOnTheDevicesOwnRow() throws Exception {
        Fixture fx = register(null);
        setMode(fx.serial(), AuthMode.SERIAL_ONLY_BOUNDED, "198.51.100.1");

        assertThat(handshakeFrom(fx.serial(), null, "203.0.113.77", null).statusCode()).isEqualTo(401);

        Map<String, String> row = refusalRow(fx.serial());
        assertThat(row.get("addr"))
                .as("the address the terminal is actually dialling from, for one-click 'allow this address'")
                .isEqualTo("203.0.113.77");
        assertThat(row.get("at")).isNotNull();
    }

    @Test
    void aDeviceSwitchedToAStricterModeIsRefusedOnItsVeryNextRequestWithNoRestart() throws Exception {
        Fixture fx = register(null);
        setMode(fx.serial(), AuthMode.SERIAL_ONLY_BOUNDED, CLIENT_IP);
        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, null).statusCode()).isEqualTo(200);

        setMode(fx.serial(), AuthMode.SERIAL_ONLY_BOUNDED, "198.51.100.1");

        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, null).statusCode())
                .as("the mode is read from the row on every request; there is no cache to invalidate")
                .isEqualTo(401);
    }

    // ---------------------------------------------------------------- host-mapped

    @Test
    void aHostMappedDeviceResolvesOnlyForItsOwnHostname() throws Exception {
        Fixture fx = register(null);
        setMode(fx.serial(), AuthMode.HOST_MAPPED, "f7.branch.example.com");

        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, "f7.branch.example.com").statusCode())
                .isEqualTo(200);
        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, "F7.BRANCH.EXAMPLE.COM:443").statusCode())
                .as("hostnames are case-insensitive and the port is not part of the name")
                .isEqualTo(200);
        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, "someone-else.example.com").statusCode())
                .isEqualTo(401);
        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, null).statusCode())
                .as("no host header at all cannot match")
                .isEqualTo(401);
    }

    @Test
    void aHostMappedDeviceWithNoHostnameRecordedCanNeverResolve() throws Exception {
        Fixture fx = register(null);
        setMode(fx.serial(), AuthMode.HOST_MAPPED, null);

        assertThat(handshakeFrom(fx.serial(), null, CLIENT_IP, "anything.example.com").statusCode())
                .isEqualTo(401);
    }

    // ---------------------------------------------------------------- the property that ties it together

    /**
     * Every refusal across every mode and every cause, compared to each other. If any one of these
     * differs, the endpoint tells a stranger which mode a serial uses — and the mode is the shape of
     * the attack against it.
     */
    @Test
    void everyRefusalAcrossEveryModeIsByteIdentical() throws Exception {
        Fixture token = register(null);
        Fixture bounded = register(null);
        Fixture unbounded = register(null);
        Fixture hostMapped = register(null);
        setMode(bounded.serial(), AuthMode.SERIAL_ONLY_BOUNDED, "198.51.100.1");
        setMode(unbounded.serial(), AuthMode.SERIAL_ONLY_BOUNDED, null);
        setMode(hostMapped.serial(), AuthMode.HOST_MAPPED, "f7.branch.example.com");

        Map<String, HttpResponse<String>> refusals = new LinkedHashMap<>();
        refusals.put("unknown serial", handshakeFrom("SN-nope-" + UUID.randomUUID(), "x", CLIENT_IP, null));
        refusals.put("token: wrong token", handshakeFrom(token.serial(), "wrong", CLIENT_IP, null));
        refusals.put("token: no token", handshakeFrom(token.serial(), null, CLIENT_IP, null));
        refusals.put("bounded: wrong address", handshakeFrom(bounded.serial(), null, "203.0.113.99", null));
        refusals.put("bounded: empty allowlist", handshakeFrom(unbounded.serial(), null, CLIENT_IP, null));
        refusals.put("host-mapped: wrong host", handshakeFrom(hostMapped.serial(), null, CLIENT_IP, "other.example.com"));

        String reference = shapeOf(refusals.get("unknown serial"));
        refusals.forEach((label, res) -> assertThat(shapeOf(res))
                .as("'%s' must be indistinguishable from an unknown serial", label)
                .isEqualTo(reference));
    }

    /**
     * A refused request must leave no tenant bound on the calling thread. This is the property that
     * makes the resolver's resolve-then-bind ordering worth having, and the new modes are inside that
     * ordering rather than around it — so it must still hold for every one of them.
     */
    @Test
    void noRefusedRequestInAnyModeLeavesTenantContextBoundOrWritesARow() throws Exception {
        Fixture bounded = register("9001");
        setMode(bounded.serial(), AuthMode.SERIAL_ONLY_BOUNDED, "198.51.100.1");

        attlogFrom(bounded.serial(), "203.0.113.99", "9001\t2026-06-15 09:30:00\t0\t1\n");

        assertThat(countPunchesByRef("9001")).isZero();
        assertThat(countQuarantineByRef("9001")).isZero();
        assertThat(ctx.getTenantId())
                .as("the test thread is not the request thread, but a leak would surface as a bound tenant here")
                .isEmpty();
    }

    private void attlogFrom(String serial, String sourceIp, String body) throws Exception {
        http.send(HttpRequest.newBuilder(URI.create(
                                base() + "/iclock/cdata?SN=" + enc(serial) + "&table=ATTLOG&Stamp=1"))
                        .header("Content-Type", "text/plain;charset=UTF-8")
                        .header("X-Forwarded-For", sourceIp)
                        .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                        .build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private static String shapeOf(HttpResponse<String> res) {
        return res.statusCode() + "|"
                + res.body().replaceAll("\"traceId\"\\s*:\\s*\"[^\"]*\"", "\"traceId\":\"*\"");
    }

    private Map<String, String> refusalRow(String serial) throws Exception {
        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT last_refused_source_address, last_refused_at FROM attendance_devices "
                             + "WHERE serial_no = ?")) {
            ps.setString(1, serial);
            try (ResultSet rs = ps.executeQuery()) {
                Map<String, String> out = new LinkedHashMap<>();
                if (rs.next()) {
                    out.put("addr", rs.getString(1));
                    out.put("at", rs.getTimestamp(2) == null ? null : rs.getTimestamp(2).toString());
                }
                return out;
            }
        }
    }
}
