package io.restaurantos.platform;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The SuperAdmin impersonation READ path — the half that existed structurally and did nothing.
 *
 * <h2>What this is protecting</h2>
 *
 * <p>{@code impersonation_log} has been written correctly since PLATFORM-05 and, until the change
 * these tests accompany, could not be read by the platform SuperAdmin at all:
 * {@code GET /api/v1/platform/tenants/{id}/impersonations} was 404, and
 * {@code ImpersonationLogRepository.findByTenantIdOrderByStartedAtDesc} had zero callers anywhere
 * in the product. The tenant-facing half (audit-service's {@code IMPERSONATION_STARTED} events) was
 * already built and is deliberately not duplicated.
 *
 * <h2>The one test that matters most is {@link #statusComesFromExpiresAt_notFromEndedAt}</h2>
 *
 * <p>{@code ended_at} is a column with no writer anywhere in this product. The obvious reading —
 * "no end recorded, so the session is still running" — marks every impersonation ever performed as
 * ACTIVE, permanently. The two rows in that test differ ONLY in {@code expires_at} and both have
 * {@code ended_at} NULL, so any implementation that consults {@code ended_at} returns the same
 * status for both and the test goes red. It is written that way on purpose: the correct rule is one
 * line, which is exactly the kind that gets "simplified" later by someone reading the column name.
 *
 * <h2>Rows are inserted with JDBC rather than by impersonating</h2>
 *
 * <p>Because the expiry has to be controlled: an impersonation driven through the API always writes
 * {@code now() + 30 minutes}, so it can only ever produce an ACTIVE row and the EXPIRED branch would
 * never execute. {@code ImpersonationActorIT} already covers the write path end to end.
 */
class ImpersonationReadPathIT extends BasePlatformIT {

    private static final UUID SUPER_ADMIN_ID = UUID.fromString("eca6bbf2-ce62-5d16-8f4c-d052521d16ad");

    @Test
    void aSuperAdminCanReadOneTenantsImpersonations_theWiringThatHadNoCaller() {
        UUID tenantId = seedTenant("read-path-a");
        UUID target = UUID.randomUUID();
        UUID rowId = insertLog(tenantId, SUPER_ADMIN_ID, target,
            Instant.now().minus(2, ChronoUnit.HOURS),
            Instant.now().minus(90, ChronoUnit.MINUTES),
            "looked at a broken report");

        ResponseEntity<String> res = httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + tenantId + "/impersonations");

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        String body = res.getBody();
        assertThat(body).contains(rowId.toString());
        assertThat(body).contains(target.toString());
        assertThat(body).contains("looked at a broken report");
        assertThat(body).contains("\"totalCount\":1");
    }

    /**
     * Two rows, identical but for {@code expires_at}, both with {@code ended_at} NULL.
     *
     * <p>A status derived from {@code ended_at} cannot tell them apart. That is the entire point.
     */
    @Test
    void statusComesFromExpiresAt_notFromEndedAt() {
        UUID tenantId = seedTenant("read-path-status");
        UUID expiredTarget = UUID.randomUUID();
        UUID activeTarget = UUID.randomUUID();

        insertLog(tenantId, SUPER_ADMIN_ID, expiredTarget,
            Instant.now().minus(3, ChronoUnit.HOURS),
            Instant.now().minus(150, ChronoUnit.MINUTES), "over");
        insertLog(tenantId, SUPER_ADMIN_ID, activeTarget,
            Instant.now().minus(1, ChronoUnit.MINUTES),
            Instant.now().plus(29, ChronoUnit.MINUTES), "still going");

        // Neither row has an ended_at, and nothing in the product would ever give one.
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM impersonation_log WHERE tenant_id = ? AND ended_at IS NOT NULL",
                Long.class, tenantId))
            .as("ended_at has no writer, so it must be null on every row this test reads")
            .isZero();

        String body = httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + tenantId + "/impersonations").getBody();

        assertThat(statusOfTarget(body, activeTarget))
            .as("expires_at in the future")
            .isEqualTo("ACTIVE");
        assertThat(statusOfTarget(body, expiredTarget))
            .as("expires_at in the past — and ended_at is null here too, so a status read off "
                + "ended_at would have said ACTIVE")
            .isEqualTo("EXPIRED");
    }

    /** A null expiry is neither ACTIVE nor EXPIRED. Not knowing is not the same as knowing. */
    @Test
    void aRowWithNoExpiryIsReportedUnknown_notGuessed() {
        UUID tenantId = seedTenant("read-path-unknown");
        UUID target = UUID.randomUUID();
        insertLog(tenantId, SUPER_ADMIN_ID, target, Instant.now().minus(1, ChronoUnit.HOURS),
            null, "no expiry recorded");

        String body = httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + tenantId + "/impersonations").getBody();

        assertThat(statusOfTarget(body, target)).isEqualTo("UNKNOWN");
    }

    /**
     * The platform-wide read answers the question {@code audit_events} structurally cannot:
     * one administrator, every tenant, one query.
     */
    @Test
    void thePlatformWideReadCrossesTenants_andFiltersByActingAdministrator() {
        UUID tenantA = seedTenant("read-path-cross-a");
        UUID tenantB = seedTenant("read-path-cross-b");
        UUID otherAdmin = insertPlatformUser("other-admin-" + UUID.randomUUID() + "@softxlogic.com");
        UUID targetA = UUID.randomUUID();
        UUID targetB = UUID.randomUUID();
        UUID targetOther = UUID.randomUUID();

        insertLog(tenantA, SUPER_ADMIN_ID, targetA, Instant.now().minus(4, ChronoUnit.HOURS),
            Instant.now().minus(3, ChronoUnit.HOURS), "A");
        insertLog(tenantB, SUPER_ADMIN_ID, targetB, Instant.now().minus(3, ChronoUnit.HOURS),
            Instant.now().minus(2, ChronoUnit.HOURS), "B");
        insertLog(tenantB, otherAdmin, targetOther, Instant.now().minus(2, ChronoUnit.HOURS),
            Instant.now().minus(1, ChronoUnit.HOURS), "someone else");

        String token = platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN");

        String mine = httpGetAs(token,
            "/api/v1/platform/impersonations?adminUserId=" + SUPER_ADMIN_ID + "&size=200").getBody();
        assertThat(mine)
            .as("one administrator's trail spans tenants — this is what audit_events cannot do")
            .contains(targetA.toString())
            .contains(targetB.toString());
        assertThat(mine)
            .as("and does NOT include another administrator's sessions")
            .doesNotContain(targetOther.toString());

        String theirs = httpGetAs(token,
            "/api/v1/platform/impersonations?adminUserId=" + otherAdmin + "&size=200").getBody();
        assertThat(theirs).contains(targetOther.toString());
        assertThat(theirs).doesNotContain(targetA.toString());
    }

    /** The tenant-scoped read must not leak another tenant's rows. */
    @Test
    void theTenantScopedReadReturnsOnlyThatTenantsRows() {
        UUID tenantA = seedTenant("read-path-iso-a");
        UUID tenantB = seedTenant("read-path-iso-b");
        UUID targetA = UUID.randomUUID();
        UUID targetB = UUID.randomUUID();
        insertLog(tenantA, SUPER_ADMIN_ID, targetA, Instant.now().minus(2, ChronoUnit.HOURS),
            Instant.now().minus(1, ChronoUnit.HOURS), "A");
        insertLog(tenantB, SUPER_ADMIN_ID, targetB, Instant.now().minus(2, ChronoUnit.HOURS),
            Instant.now().minus(1, ChronoUnit.HOURS), "B");

        String body = httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + tenantA + "/impersonations").getBody();

        assertThat(body).contains(targetA.toString());
        assertThat(body).doesNotContain(targetB.toString());
        assertThat(body).contains("\"totalCount\":1");
    }

    /**
     * An unknown tenant is 404. An empty 200 would read as "nobody has ever impersonated into this
     * tenant", which is the opposite answer.
     */
    @Test
    void anUnknownTenantIs404_notAnEmptyList() {
        ResponseEntity<String> res = httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + UUID.randomUUID() + "/impersonations");

        assertThat(res.getStatusCode().value()).isEqualTo(404);
        assertThat(res.getBody()).contains("NOT_FOUND");
    }

    /**
     * An {@code adminUserId} naming no surviving account is an empty page, NOT a 404 — a deleted
     * platform account is exactly when the rows it left behind matter most.
     */
    @Test
    void anUnknownAdministratorIsAnEmptyPage_not404() {
        ResponseEntity<String> res = httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/impersonations?adminUserId=" + UUID.randomUUID());

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("\"totalCount\":0");
    }

    /** The class-level SUPER_ADMIN gate, on both new endpoints. */
    @Test
    void aTenantPrincipalCannotReadTheImpersonationLog() {
        UUID tenantId = seedTenant("read-path-gate");
        String owner = tenantToken(UUID.randomUUID(), tenantId, "OWNER", List.of("audit.log.view"));

        assertThat(httpGetAs(owner, "/api/v1/platform/tenants/" + tenantId + "/impersonations")
            .getStatusCode().value())
            .as("even an OWNER holding audit.log.view is not a platform principal")
            .isEqualTo(403);
        assertThat(httpGetAs(owner, "/api/v1/platform/impersonations").getStatusCode().value())
            .isEqualTo(403);
    }

    /** The token is not in the table and must never be in the response. */
    @Test
    void theResponseNeverCarriesATokenOrAnEndedAtField() {
        UUID tenantId = seedTenant("read-path-token");
        insertLog(tenantId, SUPER_ADMIN_ID, UUID.randomUUID(),
            Instant.now().minus(1, ChronoUnit.HOURS), Instant.now().minus(30, ChronoUnit.MINUTES),
            "no secrets here");

        String body = httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + tenantId + "/impersonations").getBody();

        assertThat(body).doesNotContain("\"token\"");
        assertThat(body)
            .as("ended_at has no writer; shipping an always-null field invites a screen to render it")
            .doesNotContain("\"endedAt\"");
    }

    /** {@code totalCount} counts matches, not the page — a pager cannot say "of 3" without it. */
    @Test
    void totalCountIsTheWholeMatchAndNextCursorEndsTheList() {
        UUID tenantId = seedTenant("read-path-paging");
        for (int i = 0; i < 3; i++) {
            insertLog(tenantId, SUPER_ADMIN_ID, UUID.randomUUID(),
                Instant.now().minus(10 + i, ChronoUnit.HOURS),
                Instant.now().minus(9 + i, ChronoUnit.HOURS), "row " + i);
        }

        String token = platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN");
        String first = httpGetAs(token,
            "/api/v1/platform/tenants/" + tenantId + "/impersonations?size=2&page=0").getBody();
        assertThat(first).contains("\"totalCount\":3");
        assertThat(first).contains("\"nextCursor\":\"1\"");

        String last = httpGetAs(token,
            "/api/v1/platform/tenants/" + tenantId + "/impersonations?size=2&page=1").getBody();
        assertThat(last).contains("\"totalCount\":3");
        assertThat(last).contains("\"nextCursor\":null");
    }

    /** An unparseable bound is a named 422, never a silently dropped filter. */
    @Test
    void anUnparseableTimeBoundIsRefusedByName() {
        ResponseEntity<String> res = httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/impersonations?from=last-tuesday");

        assertThat(res.getStatusCode().value()).isEqualTo(422);
        assertThat(res.getBody()).contains("INVALID_TIME_BOUND");
        assertThat(res.getBody()).contains("\"from\"");
    }

    // --- Helpers ---

    /**
     * A tenant row written directly.
     *
     * <p>The provisioning saga is not used: it needs four WireMock stubs and a Liquibase-seeded
     * feature matrix to reach the one thing these tests need, which is a tenant id that resolves.
     */
    private UUID seedTenant(String slugPrefix) {
        UUID id = UUID.randomUUID();
        wireMockStubJwks();
        jdbc.update("INSERT INTO tenants (id, slug, brand_name, status, tier) VALUES (?,?,?,?,?)",
            id, slugPrefix + "-" + id, "Read Path " + slugPrefix, "ACTIVE", "STARTER");
        return id;
    }

    private UUID insertPlatformUser(String email) {
        UUID id = UUID.randomUUID();
        jdbc.update(
            "INSERT INTO platform_users (id, email, password_hash, role, is_active) VALUES (?,?,?,?,?)",
            id, email, "$2a$12$notarealhash", "SUPER_ADMIN", true);
        return id;
    }

    /**
     * One impersonation row, with {@code ended_at} deliberately left NULL — which is the only
     * value it ever has in production, because nothing writes it.
     */
    private UUID insertLog(UUID tenantId, UUID adminId, UUID targetId,
                           Instant startedAt, Instant expiresAt, String reason) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO impersonation_log
                    (id, platform_user_id, tenant_id, target_user_id, started_at, ended_at,
                     expires_at, reason)
                VALUES (?,?,?,?,?,NULL,?,?)
                """,
            id, adminId, tenantId, targetId,
            java.sql.Timestamp.from(startedAt),
            expiresAt == null ? null : java.sql.Timestamp.from(expiresAt),
            reason);
        return id;
    }

    /**
     * The {@code status} of the record whose {@code targetUserId} is {@code target}.
     *
     * <p>Read out of the raw JSON rather than by binding the DTO: binding to the type under test
     * would make a renamed or removed field a compile error here instead of a failing assertion,
     * and the wire shape is what a console actually consumes.
     */
    private String statusOfTarget(String body, UUID target) {
        int at = body.indexOf(target.toString());
        assertThat(at).as("record for target %s is present in the response", target).isGreaterThan(-1);
        int statusAt = body.indexOf("\"status\":\"", at);
        assertThat(statusAt).isGreaterThan(-1);
        int from = statusAt + "\"status\":\"".length();
        return body.substring(from, body.indexOf('"', from));
    }
}
