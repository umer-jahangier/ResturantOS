package io.restaurantos.platform.service;

import io.restaurantos.platform.client.AuditPlatformClient;
import io.restaurantos.platform.dto.PlatformAuditViewDtos.AuditCoverage;
import io.restaurantos.platform.dto.PlatformAuditViewDtos.CoverageItem;
import io.restaurantos.platform.dto.PlatformAuditViewDtos.PlatformAuditPage;
import io.restaurantos.platform.repository.TenantAnalyticsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The platform audit surface's contract with the reader.
 *
 * <p>Three things it must never do, each asserted below: silently widen a tenant filter to the
 * whole platform, present an incomplete total as a fact, or let a tenant whose log failed to read
 * be indistinguishable from a tenant with no history. All three produce a screen that looks
 * perfectly normal and is wrong in the direction an auditor cannot detect.
 */
class PlatformAuditTrailServiceTest {

    private AuditPlatformClient auditClient;
    private TenantAnalyticsRepository tenants;
    private PlatformAuditTrailService service;

    private final UUID tenantA = UUID.randomUUID();
    private final UUID tenantB = UUID.randomUUID();

    private static final Instant FROM = Instant.parse("2026-06-01T00:00:00Z");
    private static final Instant TO = Instant.parse("2026-06-30T23:59:59Z");

    @BeforeEach
    void setUp() {
        auditClient = mock(AuditPlatformClient.class);
        tenants = mock(TenantAnalyticsRepository.class);
        service = new PlatformAuditTrailService(auditClient, tenants);

        when(tenants.findAllTenantIdentities()).thenReturn(List.of(
                new Object[]{tenantA, "acme", "Acme Foods"},
                new Object[]{tenantB, "bistro", "Bistro Ltd"}));
        when(tenants.findAllTenantIds()).thenReturn(List.of(tenantA, tenantB));
    }

    @Test
    @DisplayName("rows are attributed to a tenant the console can name")
    void rowsCarryTenantSlugAndBrand() {
        when(auditClient.search(any())).thenReturn(response(
                List.of(event(tenantA, "USER_LOGIN_SUCCEEDED")), 1L, true, List.of(tenantA, tenantB),
                List.of()));

        PlatformAuditPage page = service.search(null, null, null, null, FROM, TO, "UTC", 0, 50, false);

        assertThat(page.events()).hasSize(1);
        assertThat(page.events().get(0).tenantSlug()).isEqualTo("acme");
        assertThat(page.events().get(0).tenantBrandName()).isEqualTo("Acme Foods");
        assertThat(page.tenantsInScope()).isEqualTo(2);
        assertThat(page.totalCountComplete()).isTrue();
    }

    @Test
    @DisplayName("a tenant that failed to read is named, and the total is marked incomplete")
    void aFailedTenantIsNeverAnEmptyLog() {
        when(auditClient.search(any())).thenReturn(response(
                List.of(event(tenantA, "ROLE_GRANTED")), 1L, false, List.of(tenantA),
                List.of(new AuditPlatformClient.TenantReadFailure(tenantB, "SQLException: timeout"))));

        PlatformAuditPage page = service.search(null, null, null, null, FROM, TO, "UTC", 0, 50, false);

        assertThat(page.totalCountComplete())
                .as("""
                    One of two tenants did not answer, so 1 is a LOWER BOUND. Printing it as a \
                    fact tells the reader their trail is smaller than it is — the most damaging \
                    direction to be wrong in on an audit surface.""")
                .isFalse();
        assertThat(page.tenantsFailed()).hasSize(1);
        assertThat(page.tenantsFailed().get(0).tenantSlug())
                .as("the failure is named in terms the operator recognises, not just a UUID")
                .isEqualTo("bistro");
        assertThat(page.tenantsRead()).isEqualTo(1);
        assertThat(page.tenantsInScope()).isEqualTo(2);
    }

    @Test
    @DisplayName("an unknown tenant filter is refused, never silently widened to every tenant")
    void unknownTenantIsRefused() {
        assertThatThrownBy(() -> service.search(UUID.randomUUID(), null, null, null,
                FROM, TO, "UTC", 0, 50, false))
                .as("""
                    A filter that silently stops filtering shows an operator every tenant's audit \
                    log when they asked for one. Refusing is the only safe direction.""")
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a body the client cannot read is refused, not served as an empty trail")
    void anUnreadableUpstreamBodyIsNotAnEmptyTrail() {
        when(auditClient.search(any())).thenReturn(new AuditPlatformClient.SearchResponse(null));

        assertThatThrownBy(() -> service.search(null, null, null, null, FROM, TO, "UTC", 0, 50, false))
                .as("the same posture as UsageMeter.unreadable: not knowing is not the same as "
                    + "knowing there is nothing")
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("login history filters on both login actions, spelled as the catalog spells them")
    void loginHistoryUsesTheCatalogActionNames() {
        when(auditClient.search(any())).thenReturn(response(List.of(), 0L, true,
                List.of(tenantA, tenantB), List.of()));

        service.loginHistory(null, null, false, FROM, TO, "UTC", 0, 50);

        ArgumentCaptor<AuditPlatformClient.SearchRequest> captor =
                ArgumentCaptor.forClass(AuditPlatformClient.SearchRequest.class);
        verify(auditClient).search(captor.capture());

        assertThat(captor.getValue().actions())
                .as("""
                    A typo in either name produces an EMPTY screen rather than an error, and an \
                    empty audit screen is read as "nobody logged in" — a materially wrong answer \
                    to give a security review.""")
                .containsExactlyInAnyOrder("USER_LOGIN_SUCCEEDED", "USER_LOGIN_FAILED");
    }

    @Test
    @DisplayName("failedOnly narrows to failures, which is the shape a brute-force review wants")
    void failedOnlyNarrowsToFailures() {
        when(auditClient.search(any())).thenReturn(response(List.of(), 0L, true,
                List.of(tenantA, tenantB), List.of()));

        service.loginHistory(tenantA, null, true, FROM, TO, "UTC", 0, 50);

        ArgumentCaptor<AuditPlatformClient.SearchRequest> captor =
                ArgumentCaptor.forClass(AuditPlatformClient.SearchRequest.class);
        verify(auditClient).search(captor.capture());

        assertThat(captor.getValue().actions()).containsExactly("USER_LOGIN_FAILED");
        assertThat(captor.getValue().tenantIds())
                .as("a named tenant narrows the fan-out to one tenant rather than filtering after")
                .containsExactly(tenantA);
    }

    @Test
    @DisplayName("authority changes include impersonation starts")
    void authorityChangesIncludeImpersonation() {
        when(auditClient.search(any())).thenReturn(response(List.of(), 0L, true,
                List.of(tenantA, tenantB), List.of()));

        service.authorityChanges(null, null, FROM, TO, "UTC", 0, 50);

        ArgumentCaptor<AuditPlatformClient.SearchRequest> captor =
                ArgumentCaptor.forClass(AuditPlatformClient.SearchRequest.class);
        verify(auditClient).search(captor.capture());

        assertThat(captor.getValue().actions())
                .as("""
                    Reading a role grant without seeing who was wearing whose account at the time \
                    turns an accountability trail into a list of names.""")
                .contains("ROLE_GRANTED", "ROLE_REVOKED", "ADMIN_PASSWORD_RESET",
                        "IMPERSONATION_STARTED");
    }

    @Test
    @DisplayName("coverage states the SuperAdmin login gap rather than leaving an empty tile")
    void coverageNamesTheGapsItCannotFill() {
        AuditCoverage coverage = service.coverage();

        assertThat(coverage.captured()).isNotEmpty();
        assertThat(coverage.notCaptured()).isNotEmpty();

        String notCaptured = coverage.notCaptured().stream()
                .map(CoverageItem::detail).reduce("", (a, b) -> a + " " + b);

        assertThat(notCaptured)
                .as("""
                    A "SuperAdmin activity" tile drawn from audit_events would be empty and read \
                    like a quiet week. audit_events.tenant_id is NOT NULL and a platform login has \
                    no tenant; platform_users has no last_login_at column at all. The console has \
                    to be told, or it will draw the tile.""")
                .containsIgnoringCase("platform_users")
                .containsIgnoringCase("last_login_at");

        assertThat(coverage.immutability())
                .as("read-only is a property of the schema and belongs in the contract")
                .containsIgnoringCase("append-only");
        assertThat(coverage.retention()).isNotBlank();
    }

    // ── fixtures ──────────────────────────────────────────────────────────────

    private static AuditPlatformClient.AuditEvent event(UUID tenantId, String action) {
        return new AuditPlatformClient.AuditEvent(
                1L, tenantId, Instant.parse("2026-06-15T10:00:00Z"), action, "USER",
                UUID.randomUUID().toString(), null, UUID.randomUUID(), null, "10.0.0.1",
                "curl/8", null);
    }

    private static AuditPlatformClient.SearchResponse response(
            List<AuditPlatformClient.AuditEvent> events,
            long totalCount,
            boolean complete,
            List<UUID> read,
            List<AuditPlatformClient.TenantReadFailure> failed) {
        return new AuditPlatformClient.SearchResponse(new AuditPlatformClient.SearchData(
                events, totalCount, complete, read, failed, FROM, TO, 0, 50, null, false));
    }
}
