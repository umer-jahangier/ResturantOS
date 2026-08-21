package io.restaurantos.file.service;

import io.restaurantos.file.client.PlatformAdminClient;
import io.restaurantos.file.config.TierStorageProperties;
import io.restaurantos.file.exception.QuotaExceededException;
import io.restaurantos.shared.api.ApiResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.Mockito.anyLong;
import static org.mockito.Mockito.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * QuotaService is the only thing standing between a tenant and unbounded storage spend, and it
 * is a gate that has exactly two ways to fail badly: it can refuse an upload that was legal, or
 * it can wave through an upload that was not. Both failures live in one comparison —
 * {@code newTotal > limitBytes} — so the tests that matter here sit on that single byte.
 *
 * <p>Three properties are load-bearing and each has a test whose name says so:
 * <ul>
 *   <li><b>The limit is inclusive.</b> Landing <i>exactly</i> on the cap is allowed; one byte
 *       past it is refused. An off-by-one here is a silent billing or availability bug.</li>
 *   <li><b>A refusal must not leak the reservation.</b> {@code checkQuota} increments first and
 *       asks questions second, so every refusal owes the tenant a DECRBY of the exact same
 *       amount. {@link Refusals#aRefusedUploadLeavesTheCounterExactlyWhereItStarted()} runs a
 *       stateful counter through refuse-then-retry to prove the bytes actually came back —
 *       verifying the call alone would pass even if the rollback used the wrong delta.</li>
 *   <li><b>It fails closed.</b> If platform-admin is unreachable the tier is unknown, and an
 *       unknown tier must never be read as "no limit". The tier lookup happens before the
 *       reservation, so an outage must reserve nothing at all.</li>
 * </ul>
 *
 * <p>The refusal's <i>legibility</i> is asserted verbatim, not with a {@code contains} — the
 * 409 body a tenant sees is built from {@code usedBytes}/{@code limitBytes}, and
 * {@code usedBytes} is derived arithmetic ({@code newTotal - newFileSizeBytes}), not a value
 * anyone read back from Redis. It is the field most likely to quietly become wrong.
 */
@ExtendWith(MockitoExtension.class)
class QuotaServiceTest {

    private static final UUID TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID OTHER_TENANT = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final String KEY = "storage:bytes:" + TENANT;
    private static final String OTHER_KEY = "storage:bytes:" + OTHER_TENANT;

    /** Documented product defaults from TierStorageProperties. */
    private static final long STARTER_LIMIT = 10_737_418_240L;
    private static final long GROWTH_LIMIT = 53_687_091_200L;
    private static final long ENTERPRISE_LIMIT = 536_870_912_000L;

    @Mock
    private PlatformAdminClient platformAdminClient;
    @Mock
    private StringRedisTemplate redisTemplate;
    @Mock
    private ValueOperations<String, String> valueOps;

    private TierStorageProperties tiers;
    private QuotaService quotaService;

    @BeforeEach
    void setUp() {
        tiers = new TierStorageProperties();
        quotaService = new QuotaService(platformAdminClient, redisTemplate, tiers);
        // Lenient: the fail-closed tests must reach Redis zero times, and that is the assertion.
        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOps);
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────

    private void tenantIsOnTier(UUID tenantId, String tier) {
        when(platformAdminClient.getTenantStatus(tenantId))
                .thenReturn(ApiResponse.ok(new PlatformAdminClient.TenantStatusResponse("ACTIVE", tier)));
    }

    /** Collapses the tier table to a single small number so boundary maths is readable. */
    private void tenantHasLimit(long limitBytes) {
        Map<String, Long> limits = new HashMap<>();
        limits.put("starter", limitBytes);
        tiers.setLimits(limits);
        tenantIsOnTier(TENANT, "STARTER");
    }

    private void redisIncrementReturns(Long newTotal) {
        when(valueOps.increment(anyString(), anyLong())).thenReturn(newTotal);
    }

    // ── the boundary itself ─────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("the limit is inclusive: == passes, +1 refuses")
    class TheBoundary {

        @Test
        void anUploadLandingExactlyOnTheLimitIsAllowedAndNothingIsRolledBack() {
            tenantHasLimit(1_000L);
            redisIncrementReturns(1_000L);

            assertThatCode(() -> quotaService.checkQuota(TENANT, 400L)).doesNotThrowAnyException();

            verify(valueOps).increment(KEY, 400L);
            verify(valueOps, never()).decrement(anyString(), anyLong());
        }

        @Test
        void anUploadLandingOneByteUnderTheLimitIsAllowed() {
            tenantHasLimit(1_000L);
            redisIncrementReturns(999L);

            assertThatCode(() -> quotaService.checkQuota(TENANT, 400L)).doesNotThrowAnyException();

            verify(valueOps, never()).decrement(anyString(), anyLong());
        }

        @Test
        void anUploadLandingOneByteOverTheLimitIsRefusedAndRolledBackByTheExactAmount() {
            tenantHasLimit(1_000L);
            redisIncrementReturns(1_001L);

            Throwable thrown = catchThrowable(() -> quotaService.checkQuota(TENANT, 400L));

            assertThat(thrown).isInstanceOf(QuotaExceededException.class);
            QuotaExceededException ex = (QuotaExceededException) thrown;
            assertThat(ex.getQuotaType()).isEqualTo("STORAGE_GB");
            assertThat(ex.getUsedBytes()).isEqualTo(601L);   // 1001 reserved - 400 being added
            assertThat(ex.getLimitBytes()).isEqualTo(1_000L);
            verify(valueOps).decrement(KEY, 400L);
        }

        @Test
        void theRealStarterCapIsEnforcedAtItsExactByteValue() {
            tenantIsOnTier(TENANT, "STARTER");
            redisIncrementReturns(STARTER_LIMIT + 1);

            Throwable thrown = catchThrowable(() -> quotaService.checkQuota(TENANT, 1L));

            assertThat(thrown).isInstanceOf(QuotaExceededException.class);
            QuotaExceededException ex = (QuotaExceededException) thrown;
            assertThat(ex.getUsedBytes()).isEqualTo(STARTER_LIMIT);
            assertThat(ex.getLimitBytes()).isEqualTo(STARTER_LIMIT);
        }
    }

    // ── refusals: rollback, wording, and pathological inputs ─────────────────────────────────

    @Nested
    @DisplayName("refusals are legible and cost the tenant nothing")
    class Refusals {

        @Test
        @DisplayName("the 409 message names the type, the usage and the cap verbatim")
        void theRefusalMessageIsExact() {
            tenantHasLimit(1_000L);
            redisIncrementReturns(1_500L);

            assertThatThrownBy(() -> quotaService.checkQuota(TENANT, 900L))
                    .isInstanceOf(QuotaExceededException.class)
                    .hasMessage("Quota exceeded for STORAGE_GB: used=600 bytes, limit=1000 bytes");
        }

        /**
         * The one test here that would still pass if the rollback were merely <i>called</i> is
         * the one above. This one drives a real counter: 600 in, 600 refused, and the retry that
         * lands exactly on the cap only succeeds if the refused 600 was genuinely handed back.
         */
        @Test
        void aRefusedUploadLeavesTheCounterExactlyWhereItStarted() {
            AtomicLong counter = new AtomicLong();
            tenantHasLimit(1_000L);
            when(valueOps.increment(anyString(), anyLong()))
                    .thenAnswer(inv -> counter.addAndGet(inv.getArgument(1, Long.class)));
            when(valueOps.decrement(anyString(), anyLong()))
                    .thenAnswer(inv -> counter.addAndGet(-inv.getArgument(1, Long.class)));

            quotaService.checkQuota(TENANT, 600L);
            assertThat(counter.get()).isEqualTo(600L);

            assertThatThrownBy(() -> quotaService.checkQuota(TENANT, 600L))
                    .isInstanceOf(QuotaExceededException.class);
            assertThat(counter.get())
                    .as("a refused reservation must not be left behind as phantom usage")
                    .isEqualTo(600L);

            // Only reachable if the 600 really came back: 600 + 400 == the cap exactly.
            assertThatCode(() -> quotaService.checkQuota(TENANT, 400L)).doesNotThrowAnyException();
            assertThat(counter.get()).isEqualTo(1_000L);
        }

        @Test
        @DisplayName("a tenant already over the cap (Redis/DB drift) is refused even at zero bytes")
        void aZeroByteUploadIsStillRefusedWhenTheTenantIsAlreadyOverTheCap() {
            tenantHasLimit(1_000L);
            redisIncrementReturns(1_001L);

            Throwable thrown = catchThrowable(() -> quotaService.checkQuota(TENANT, 0L));

            assertThat(thrown).isInstanceOf(QuotaExceededException.class);
            QuotaExceededException ex = (QuotaExceededException) thrown;
            assertThat(ex.getUsedBytes()).isEqualTo(1_001L);
            assertThat(ex.getLimitBytes()).isEqualTo(1_000L);
            verify(valueOps).decrement(KEY, 0L);
        }

        @Test
        void aZeroByteUploadByATenantSittingExactlyOnTheCapIsAllowed() {
            tenantHasLimit(1_000L);
            redisIncrementReturns(1_000L);

            assertThatCode(() -> quotaService.checkQuota(TENANT, 0L)).doesNotThrowAnyException();

            verify(valueOps, never()).decrement(anyString(), anyLong());
        }
    }

    // ── a null reply from Redis must not open the gate ───────────────────────────────────────

    @Nested
    @DisplayName("a null INCRBY reply is treated as a fresh counter, not as consent")
    class NullRedisReply {

        @Test
        void aNullReplyStillRefusesAFileBiggerThanTheWholeQuota() {
            tenantHasLimit(1_000L);
            redisIncrementReturns(null);

            Throwable thrown = catchThrowable(() -> quotaService.checkQuota(TENANT, 1_500L));

            assertThat(thrown).isInstanceOf(QuotaExceededException.class);
            QuotaExceededException ex = (QuotaExceededException) thrown;
            assertThat(ex.getUsedBytes())
                    .as("with no known prior usage the tenant is reported at zero, not at null")
                    .isZero();
            assertThat(ex.getLimitBytes()).isEqualTo(1_000L);
            verify(valueOps).decrement(KEY, 1_500L);
        }

        @Test
        void aNullReplyAllowsAFileThatFitsInsideTheWholeQuota() {
            tenantHasLimit(1_000L);
            redisIncrementReturns(null);

            assertThatCode(() -> quotaService.checkQuota(TENANT, 1_000L))
                    .as("the null fallback assumes the file is the only usage, so the cap is inclusive here too")
                    .doesNotThrowAnyException();

            verify(valueOps, never()).decrement(anyString(), anyLong());
        }
    }

    // ── fail-closed on an unknown tier ───────────────────────────────────────────────────────

    @Nested
    @DisplayName("an unknown tier is never read as 'no limit'")
    class TierResolution {

        @Test
        void tierNamesAreMatchedCaseInsensitively() {
            tenantIsOnTier(TENANT, "GROWTH");
            assertThat(quotaService.getStorageLimitBytes(TENANT)).isEqualTo(GROWTH_LIMIT);
        }

        @Test
        void enterpriseGetsTheEnterpriseCapNotTheStarterOne() {
            tenantIsOnTier(TENANT, "enterprise");
            assertThat(quotaService.getStorageLimitBytes(TENANT)).isEqualTo(ENTERPRISE_LIMIT);
        }

        @Test
        @DisplayName("an unrecognised tier degrades to the smallest cap, not to unlimited")
        void anUnknownTierFallsBackToStarter() {
            tenantIsOnTier(TENANT, "PLATINUM_UNLIMITED");
            assertThat(quotaService.getStorageLimitBytes(TENANT)).isEqualTo(STARTER_LIMIT);
        }

        @Test
        void aNullTierFallsBackToStarter() {
            tenantIsOnTier(TENANT, null);
            assertThat(quotaService.getStorageLimitBytes(TENANT)).isEqualTo(STARTER_LIMIT);
        }

        @Test
        @DisplayName("an empty envelope from platform-admin falls back to starter")
        void aResponseWithNoDataFallsBackToStarter() {
            when(platformAdminClient.getTenantStatus(TENANT))
                    .thenReturn(new ApiResponse<>(null, null, List.of()));

            assertThat(quotaService.getStorageLimitBytes(TENANT)).isEqualTo(STARTER_LIMIT);
        }
    }

    // ── fail-closed on an unreachable platform-admin ─────────────────────────────────────────

    @Nested
    @DisplayName("platform-admin being down blocks the upload and reserves nothing")
    class FailClosed {

        @Test
        void theTierLookupFailureIsPropagatedRatherThanDefaulted() {
            when(platformAdminClient.getTenantStatus(TENANT))
                    .thenThrow(new IllegalStateException("platform-admin unreachable"));

            assertThatThrownBy(() -> quotaService.checkQuota(TENANT, 500L))
                    .as("swallowing this would silently grant the starter cap to an enterprise tenant")
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("platform-admin unreachable");
        }

        @Test
        @DisplayName("no INCRBY is issued when the tier is unknown, so there is nothing to roll back")
        void noQuotaIsReservedWhenTheTierLookupFails() {
            when(platformAdminClient.getTenantStatus(TENANT))
                    .thenThrow(new IllegalStateException("platform-admin unreachable"));

            assertThatThrownBy(() -> quotaService.checkQuota(TENANT, 500L))
                    .isInstanceOf(IllegalStateException.class);

            verifyNoInteractions(valueOps);
        }
    }

    // ── per-tenant isolation of the counter ──────────────────────────────────────────────────

    @Nested
    @DisplayName("the counter is namespaced per tenant")
    class KeyNamespacing {

        @Test
        void twoTenantsReserveAgainstTwoDifferentKeys() {
            tenantIsOnTier(TENANT, "STARTER");
            tenantIsOnTier(OTHER_TENANT, "STARTER");
            redisIncrementReturns(1L);

            quotaService.checkQuota(TENANT, 1L);
            quotaService.checkQuota(OTHER_TENANT, 1L);

            ArgumentCaptor<String> keys = ArgumentCaptor.forClass(String.class);
            verify(valueOps, times(2)).increment(keys.capture(), anyLong());
            assertThat(keys.getAllValues())
                    .as("a shared key would let one tenant's uploads exhaust another's quota")
                    .containsExactly(KEY, OTHER_KEY);
        }

        @Test
        void releaseQuotaCreditsTheSameTenantKeyByTheExactAmount() {
            quotaService.releaseQuota(TENANT, 4_096L);

            verify(valueOps).decrement(KEY, 4_096L);
        }

        @Test
        @DisplayName("a rollback does not need platform-admin, so it still works during an outage")
        void releaseQuotaNeverConsultsPlatformAdmin() {
            quotaService.releaseQuota(TENANT, 4_096L);

            verifyNoInteractions(platformAdminClient);
        }
    }
}
