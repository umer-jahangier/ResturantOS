package io.restaurantos.platform.service;

import io.restaurantos.platform.client.AuthUserDirectoryClient;
import io.restaurantos.platform.client.UserInternalClient;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.AnalyticsOverviewResponse;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.HonestSeries;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.MeterRollup;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.PlatformFigure;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.SeriesPoint;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.TenantGrowthResponse;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.UsageRollupResponse;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import io.restaurantos.platform.repository.ImpersonationLogRepository;
import io.restaurantos.platform.repository.TenantAnalyticsRepository;
import io.restaurantos.shared.api.PageMeta;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The honesty rules of platform analytics, asserted rather than described.
 *
 * <p>Three properties are load-bearing and each of them is the kind that a plausible-looking
 * refactor silently removes:
 *
 * <ol>
 *   <li>a series contains only the buckets that were actually observed — never a back-filled zero;
 *   <li>a status/tier distribution IS densified, because a closed enum over a complete table can
 *       genuinely establish a zero — the one place densification is legitimate;
 *   <li>a roll-up over a dimension nobody counted reports a null total and says how many tenants it
 *       covered, rather than summing the tenants that answered and presenting it as the platform.
 * </ol>
 *
 * <p>These run without Docker on purpose. The properties above are decisions in the service, not
 * behaviours of PostgreSQL, and a rule this consequential should not be untestable on a laptop with
 * no container runtime.
 */
class PlatformAnalyticsHonestyTest {

    private TenantAnalyticsRepository tenants;
    private ImpersonationLogRepository impersonations;
    private UserInternalClient userClient;
    private AuthUserDirectoryClient authClient;
    private StringRedisTemplate redis;
    private ValueOperations<String, String> values;

    private PlatformAnalyticsService service;

    private static final Instant FROM = Instant.parse("2026-01-01T00:00:00Z");
    private static final Instant TO = Instant.parse("2026-06-30T23:59:59Z");
    private static final ZoneId UTC = ZoneOffset.UTC;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        tenants = mock(TenantAnalyticsRepository.class);
        impersonations = mock(ImpersonationLogRepository.class);
        userClient = mock(UserInternalClient.class);
        authClient = mock(AuthUserDirectoryClient.class);
        redis = mock(StringRedisTemplate.class);
        values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);

        service = new PlatformAnalyticsService(tenants, impersonations, userClient, authClient, redis);
    }

    // ── series honesty ────────────────────────────────────────────────────────

    @Test
    @DisplayName("a month with no tenant created is ABSENT from the series, not a zero point")
    void seriesDoesNotBackFillEmptyBuckets() {
        // January and April only. February, March, May and June had nothing.
        when(tenants.findCreatedAtBetween(FROM, TO)).thenReturn(List.of(
                Instant.parse("2026-01-10T09:00:00Z"),
                Instant.parse("2026-01-22T09:00:00Z"),
                Instant.parse("2026-04-02T09:00:00Z")));
        when(tenants.findSuspendedAtBetween(FROM, TO)).thenReturn(List.of());
        when(tenants.findCancelledAtBetween(FROM, TO)).thenReturn(List.of());
        when(tenants.countCreatedBefore(FROM)).thenReturn(5L);
        when(tenants.findCreatedAtBounds()).thenReturn(List.<Object[]>of(new Object[]{
                Instant.parse("2025-03-01T00:00:00Z"), Instant.parse("2026-04-02T09:00:00Z")}));
        when(tenants.findSuspendedAtBounds()).thenReturn(List.<Object[]>of(new Object[]{null, null}));
        when(tenants.findCancelledAtBounds()).thenReturn(List.<Object[]>of(new Object[]{null, null}));

        TenantGrowthResponse growth = service.growth(FROM, TO, PlatformAnalyticsService.Interval.MONTH, UTC);
        HonestSeries created = growth.created();

        assertThat(created.points())
                .as("""
                    Six months were requested and two had observations. A dense six-point line \
                    asserts a measurement for four periods nobody measured — and before \
                    observedFrom the platform had no tenants at all, so a zero there is not a \
                    small inaccuracy, it is a fabricated data point on the chart an operator \
                    reads growth from.""")
                .hasSize(2);

        assertThat(created.points().stream().map(SeriesPoint::bucketLabel).toList())
                .containsExactly("2026-01", "2026-04");
        assertThat(created.points()).allSatisfy(point ->
                assertThat(point.count()).as("an emitted bucket always has observations").isPositive());

        assertThat(created.backFilled())
                .as("declared on the wire so a consumer can assert it rather than assume it")
                .isFalse();
    }

    @Test
    @DisplayName("the series states when the record actually begins, not when the window does")
    void seriesReportsObservationBoundsIndependentOfTheWindow() {
        Instant firstEver = Instant.parse("2025-03-01T00:00:00Z");
        when(tenants.findCreatedAtBetween(FROM, TO)).thenReturn(List.of(
                Instant.parse("2026-01-10T09:00:00Z")));
        when(tenants.findSuspendedAtBetween(FROM, TO)).thenReturn(List.of());
        when(tenants.findCancelledAtBetween(FROM, TO)).thenReturn(List.of());
        when(tenants.countCreatedBefore(FROM)).thenReturn(5L);
        when(tenants.findCreatedAtBounds()).thenReturn(List.<Object[]>of(new Object[]{
                firstEver, Instant.parse("2026-01-10T09:00:00Z")}));
        when(tenants.findSuspendedAtBounds()).thenReturn(List.<Object[]>of(new Object[]{null, null}));
        when(tenants.findCancelledAtBounds()).thenReturn(List.<Object[]>of(new Object[]{null, null}));

        HonestSeries created = service.growth(FROM, TO,
                PlatformAnalyticsService.Interval.MONTH, UTC).created();

        assertThat(created.observedFrom())
                .as("a chart starting at the window boundary implies the metric was zero before it")
                .isEqualTo(firstEver);
        assertThat(created.windowFrom()).isEqualTo(FROM);
        assertThat(created.baselineBeforeWindow())
                .as("the cumulative line has to start from the tenants that already existed")
                .isEqualTo(5L);
        assertThat(created.points().get(0).cumulative())
                .as("5 before the window plus the 1 created in January")
                .isEqualTo(6L);
    }

    @Test
    @DisplayName("suspensions offer no cumulative line, because the column overwrites itself")
    void suspensionSeriesRefusesACumulativeReading() {
        when(tenants.findCreatedAtBetween(FROM, TO)).thenReturn(List.of());
        when(tenants.findSuspendedAtBetween(FROM, TO)).thenReturn(List.of(
                Instant.parse("2026-02-11T00:00:00Z")));
        when(tenants.findCancelledAtBetween(FROM, TO)).thenReturn(List.of());
        when(tenants.countCreatedBefore(FROM)).thenReturn(0L);
        when(tenants.findCreatedAtBounds()).thenReturn(List.<Object[]>of(new Object[]{null, null}));
        when(tenants.findSuspendedAtBounds()).thenReturn(List.<Object[]>of(new Object[]{
                Instant.parse("2026-02-11T00:00:00Z"), Instant.parse("2026-02-11T00:00:00Z")}));
        when(tenants.findCancelledAtBounds()).thenReturn(List.<Object[]>of(new Object[]{null, null}));

        HonestSeries suspended = service.growth(FROM, TO,
                PlatformAnalyticsService.Interval.MONTH, UTC).suspended();

        assertThat(suspended.points()).hasSize(1);
        assertThat(suspended.points().get(0).cumulative())
                .as("""
                    tenants.suspended_at holds only the MOST RECENT suspension and no lifecycle \
                    event is published, so a running total over it counts tenants-currently-\
                    carrying-a-suspension-date, not suspensions. Offering the number invites a \
                    reader to add it up.""")
                .isNull();
        assertThat(suspended.coverage())
                .as("the limitation has to reach the screen, not just the code")
                .containsIgnoringCase("lower bound");
    }

    // ── distribution densification ────────────────────────────────────────────

    @Test
    @DisplayName("every declared status and tier appears, with a real zero for the unused ones")
    void distributionsAreDensifiedAgainstTheEnums() {
        stubEmptyOverviewWindow();
        when(tenants.countGroupedByStatus()).thenReturn(List.of(
                new Object[]{TenantStatus.ACTIVE, 4L},
                new Object[]{TenantStatus.SUSPENDED, 1L}));
        when(tenants.countGroupedByTier()).thenReturn(List.<Object[]>of(
                new Object[]{TierType.GROWTH, 5L}));

        AnalyticsOverviewResponse overview = service.overview(FROM, TO);

        assertThat(overview.tenants().byStatus())
                .as("""
                    Densifying here IS legitimate, and it is the only place in this service that it \
                    is: the six statuses are a closed compiled-in set and the table has a row per \
                    tenant, so "no tenant is currently PURGED" is a fact the query established. A \
                    time bucket establishes nothing of the kind, which is why the series above \
                    stays sparse.""")
                .containsKeys("PENDING_SETUP", "ACTIVE", "SUSPENDED", "CANCELLED", "PURGED",
                        "PROVISIONING_FAILED")
                .containsEntry("ACTIVE", 4L)
                .containsEntry("PURGED", 0L);

        assertThat(overview.tenants().byTier())
                .containsKeys("STARTER", "GROWTH", "ENTERPRISE", "CUSTOM")
                .containsEntry("GROWTH", 5L)
                .containsEntry("STARTER", 0L);

        assertThat(overview.tenants().total()).isEqualTo(5);
        assertThat(overview.tenants().active()).isEqualTo(4);
        assertThat(overview.tenants().inactive()).isEqualTo(1);
    }

    @Test
    @DisplayName("every revenue metric is present and explicitly not-measured, never omitted")
    void revenueMetricsAreStatedAbsences() {
        stubEmptyOverviewWindow();
        when(tenants.countGroupedByStatus()).thenReturn(List.of());
        when(tenants.countGroupedByTier()).thenReturn(List.of());

        AnalyticsOverviewResponse overview = service.overview(FROM, TO);

        assertThat(overview.unavailableMetrics().stream().map(PlatformFigure::name).toList())
                .as("""
                    Omitting them would leave a hole that reads as an oversight and invites the \
                    next author to add an MRR tile over a schema with no price, no invoice and no \
                    payment in it. Naming them makes the absence part of the contract.""")
                .contains("mrr", "arr", "arpu", "churn_value", "failed_payments");

        assertThat(overview.unavailableMetrics()).allSatisfy(figure -> {
            assertThat(figure.measured()).isFalse();
            assertThat(figure.value())
                    .as("null, never 0 — a zero here is a claim that we looked")
                    .isNull();
            assertThat(figure.source())
                    .as("an operator looking at 'not measured' is owed the reason")
                    .isNotBlank();
        });
    }

    // ── usage roll-up coverage ────────────────────────────────────────────────

    @Test
    @DisplayName("a roll-up reports its coverage: a tenant that did not answer is not a zero")
    void rollUpCountsCoverageRatherThanAssumingIt() {
        UUID answering = UUID.randomUUID();
        UUID silent = UUID.randomUUID();

        when(tenants.findTenantIdsByStatus(TenantStatus.ACTIVE))
                .thenReturn(List.of(answering, silent));
        when(tenants.findEntitlementsByIds(List.of(answering, silent))).thenReturn(List.of(
                new Object[]{answering, 5, 50, 20, 5000},
                new Object[]{silent, 5, 50, 20, 5000}));

        when(userClient.listBranches(answering)).thenReturn(List.of(
                new UserInternalClient.BranchSummary(UUID.randomUUID(), "HQ"),
                new UserInternalClient.BranchSummary(UUID.randomUUID(), "Branch 2")));
        when(userClient.listBranches(silent)).thenThrow(new IllegalStateException("connection refused"));

        when(authClient.list(eq(answering), anyInt(), anyInt(), anyBoolean(), any(), any(), any()))
                .thenReturn(new AuthUserDirectoryClient.UserPage(
                        List.of(), new PageMeta(new PageMeta.Page("0", null, 1), 12L)));
        when(authClient.list(eq(silent), anyInt(), anyInt(), anyBoolean(), any(), any(), any()))
                .thenThrow(new IllegalStateException("connection refused"));

        when(values.get(any())).thenReturn(null);

        UsageRollupResponse rollup = service.usageRollup(TenantStatus.ACTIVE);

        MeterRollup branches = meter(rollup, "branches");
        assertThat(branches.total())
                .as("the two branches of the tenant that answered — and only those")
                .isEqualTo(2L);
        assertThat(branches.tenantsCounted()).isEqualTo(1);
        assertThat(branches.tenantsUnreadable()).isEqualTo(1);
        assertThat(branches.complete())
                .as("""
                    A total over one of two tenants presented as complete is the fabrication this \
                    field exists to prevent. "1,240 branches" computed from nine of fourteen \
                    tenants is a different fact from the same number over fourteen, and the \
                    difference is what an operator would act on.""")
                .isFalse();

        MeterRollup users = meter(rollup, "users");
        assertThat(users.total()).isEqualTo(12L);
        assertThat(users.tenantsCounted()).isEqualTo(1);
        assertThat(users.tenantsUnreadable()).isEqualTo(1);

        MeterRollup storage = meter(rollup, "storage_gb");
        assertThat(storage.total())
                .as("null, not 0 — no producer records storage usage anywhere in this product")
                .isNull();
        assertThat(storage.tenantsNotMetered()).isEqualTo(2);
        assertThat(storage.limitTotal())
                .as("the ENTITLEMENT half is real even when the usage half is not — 20 GB each")
                .isEqualTo(40L);

        MeterRollup nlq = meter(rollup, "nlq_queries");
        assertThat(nlq.total())
                .as("""
                    An absent Redis key is 'the counter was never wired', not 'no queries were \
                    run'. Summing absent keys to zero makes an unwired platform look like an idle \
                    one.""")
                .isNull();
        assertThat(nlq.tenantsNotMetered()).isEqualTo(2);

        assertThat(rollup.tenantsInScope()).isEqualTo(2);
        assertThat(rollup.scopeTruncated()).isFalse();
        assertThat(rollup.scope()).isEqualTo("ACTIVE");
    }

    private static MeterRollup meter(UsageRollupResponse rollup, String resource) {
        return rollup.meters().stream()
                .filter(m -> m.resource().equals(resource))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no meter named " + resource));
    }

    private void stubEmptyOverviewWindow() {
        when(tenants.countGroupedByStatusAndTier()).thenReturn(List.of());
        when(tenants.findCreatedAtBetween(FROM, TO)).thenReturn(List.of());
        when(tenants.findSuspendedAtBetween(FROM, TO)).thenReturn(List.of());
        when(tenants.findCancelledAtBetween(FROM, TO)).thenReturn(List.of());
        when(tenants.countByStatus(TenantStatus.PROVISIONING_FAILED)).thenReturn(0L);
        when(tenants.countTrialsEndingBetween(FROM, TO)).thenReturn(0L);
        when(tenants.countRenewalsDueBetween(FROM, TO)).thenReturn(0L);
        when(tenants.countWithBillingRef()).thenReturn(0L);
        Page<io.restaurantos.platform.entity.ImpersonationLogEntity> empty =
                new PageImpl<>(List.of(), PageRequest.of(0, 1), 0);
        when(impersonations.findByStartedAtBetween(any(), any(), any())).thenReturn(empty);
    }
}
