package io.restaurantos.hr.adms;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DEFECT REGISTRY — the last-seen column nobody consults. <b>Owner: plan 25-10.</b>
 *
 * <p><b>Inversion protocol.</b> Every case asserts a defect <em>still reproduces</em>; red means fixed.
 * Plan 25-10 inverts each case and <b>deletes it</b>, and deletes this class when the last one goes.
 *
 * <p>This registry is <b>deliberately structural</b>, because the defect is an absence and there is no
 * request that demonstrates an absence. The column is written correctly on every authenticated call —
 * the first case proves that over the wire, so that 25-10 is building on something real — and then
 * nothing in the product ever compares it to anything. There is no staleness threshold, no sweep, no
 * warning, and no screen: a repository-wide search of the frontend for the device endpoint returns
 * nothing at all.
 *
 * <p>D-25-02 names this failure family exactly: a terminal that stopped talking three days ago is a
 * payroll problem discovered at month-end. It is the same shape as the audit log that sat at zero rows
 * for four days while every dashboard read healthy. The column existed then too.
 */
class AdmsLivenessDefectsIT extends AdmsWireTestBase {

    /**
     * ADMS-LIVE-01 — the column is written faithfully. Not a defect; the premise the defect rests on.
     *
     * <p>Pinned first so that a future change which stops writing it is caught here rather than being
     * mistaken for the staleness feature 25-10 adds. 25-10 keeps this case and deletes the two below.
     */
    @Test
    void lastSeenAdvancesOnEveryAuthenticatedCall() throws Exception {
        Fixture fx = register(null);
        assertThat(lastSeen(fx.serial())).as("never contacted").isNull();

        handshake(fx.serial(), fx.token());
        Instant afterHandshake = lastSeen(fx.serial());
        assertThat(afterHandshake).isNotNull();

        Thread.sleep(20);
        getRequest(fx.serial(), fx.token());
        assertThat(lastSeen(fx.serial())).isAfter(afterHandshake);
    }

    /**
     * ADMS-LIVE-02 — the only read of the column is a DTO projection; nothing compares it to anything.
     *
     * <p>{@code AttendanceDeviceService.toResponse} copies it into {@code DeviceResponse} and that is
     * the entire extent of its consumption. No threshold, no interval, no scheduled sweep, no
     * {@code isBefore}/{@code isAfter}/{@code Duration} anywhere near it. A value that is serialised
     * and never judged is not health monitoring, it is a column with a getter.
     */
    @Test
    void nothingInTheServiceComparesLastSeenAgainstAnyThreshold() throws Exception {
        List<Path> readers = mainJavaSources()
                .filter(p -> contains(p, "getLastSeenAt"))
                .toList();

        assertThat(readers)
                .as("exactly one file reads the column, and it is the DTO mapper")
                .hasSize(1);
        assertThat(readers.get(0).getFileName().toString()).isEqualTo("AttendanceDeviceService.java");

        String reader = Files.readString(readers.get(0));
        assertThat(reader)
                .as("it copies the value out and forms no judgement about it")
                .doesNotContain("isBefore")
                .doesNotContain("isAfter")
                .doesNotContain("Duration")
                .doesNotContain("stale")
                .doesNotContain("Stale");

        assertThat(mainJavaSources().filter(p -> contains(p, "@Scheduled")).filter(p -> contains(p, "evice")).toList())
                .as("no scheduled task looks at devices at all")
                .isEmpty();
    }

    /**
     * ADMS-LIVE-03 — nothing outside the service can see the value either.
     *
     * <p>The value reaches a response DTO, and no frontend code calls the endpoint that returns it: a
     * repository-wide search of {@code frontend/} for the attendance-device path finds nothing. So the
     * complete lifecycle of {@code last_seen_at} today is: written on every poll, read once into a
     * response object, serialised, and delivered to no caller. 25-11 builds the screen; 25-10 builds
     * the judgement that makes the screen worth opening.
     */
    @Test
    void noFrontendCodeEverAsksForTheDeviceList() throws Exception {
        Path frontend = repoRoot().resolve("frontend");
        assertThat(Files.isDirectory(frontend)).isTrue();

        try (Stream<Path> walk = Files.walk(frontend)) {
            List<Path> callers = walk
                    .filter(Files::isRegularFile)
                    .filter(p -> {
                        String s = p.toString();
                        return (s.endsWith(".ts") || s.endsWith(".tsx"))
                                && !s.contains("/node_modules/") && !s.contains("/.next/");
                    })
                    .filter(p -> contains(p, "attendance-devices") || contains(p, "attendanceDevices"))
                    .toList();
            assertThat(callers)
                    .as("there is no device screen, so nobody can see a last-contact time even in principle")
                    .isEmpty();
        }
    }

    // ---------------------------------------------------------------- helpers

    private Instant lastSeen(String serial) throws Exception {
        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT last_seen_at FROM attendance_devices WHERE serial_no = ?")) {
            ps.setString(1, serial);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                java.sql.Timestamp ts = rs.getTimestamp(1);
                return ts == null ? null : ts.toInstant();
            }
        }
    }

    private static Stream<Path> mainJavaSources() throws IOException {
        return Files.walk(repoRoot().resolve("services/hr-service/src/main/java"))
                .filter(Files::isRegularFile)
                .filter(p -> p.toString().endsWith(".java"));
    }

    private static boolean contains(Path p, String needle) {
        try {
            return Files.readString(p).contains(needle);
        } catch (IOException | RuntimeException e) {
            return false;
        }
    }

    private static Path repoRoot() {
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path candidate : List.of(cwd.resolve("../..").normalize(), cwd, cwd.resolve("../../..").normalize())) {
            if (Files.exists(candidate.resolve("services/hr-service/pom.xml"))
                    && Files.exists(candidate.resolve("frontend"))) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not locate the repository root from " + cwd);
    }
}
