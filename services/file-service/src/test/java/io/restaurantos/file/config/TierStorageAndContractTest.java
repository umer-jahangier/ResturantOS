package io.restaurantos.file.config;

import io.restaurantos.file.controller.FileController;
import io.restaurantos.file.dto.FileDtos.FileMetaResponse;
import io.restaurantos.file.dto.FileDtos.FileUploadResponse;
import io.restaurantos.file.dto.FileDtos.QuotaStatusResponse;
import io.restaurantos.file.exception.InvalidImageException;
import io.restaurantos.file.exception.QuotaExceededException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * The small classes that decide how much a tenant may store, and how a refusal reaches the user.
 *
 * <p>Nothing here is a getter test. Every case below is a decision the code makes on its own:
 *
 * <ul>
 *   <li><b>Tier lookup.</b> {@code QuotaService.getStorageLimitBytes} hands
 *       {@link TierStorageProperties#getLimitForTier(String)} the tier string exactly as
 *       platform-admin returned it — {@code "STARTER"}, uppercase — or {@code null} when the
 *       tenant record has no tier. Both go through {@code toLowerCase()} and a two-level
 *       {@code getOrDefault}, and every miss lands on the SAME answer: the starter limit. This
 *       class pins that an unrecognised tier fails DOWN (10 GiB) rather than open.</li>
 *   <li><b>Refusal legibility.</b> {@link QuotaExceededException} is the only thing the caller
 *       receives on a 409 — the handler forwards {@code getMessage()} verbatim — and
 *       {@link InvalidImageException} exists solely because a {@code ResponseStatusException}
 *       turned a fixable "wrong file" into a 500. Both are pinned to the string and the status
 *       the user actually sees.</li>
 *   <li><b>Wire shape.</b> The DTO records ARE the API contract; their component ORDER is the
 *       canonical constructor, and several same-typed String components sit in different
 *       positions in {@link FileUploadResponse} and {@link FileMetaResponse}, so a transposed
 *       argument compiles silently and ships a download URL in the filename field.</li>
 * </ul>
 *
 * <p><b>Not covered here, deliberately:</b> Spring's binding of {@code restaurantos.tier-storage.*}
 * (needs a context), {@code QuotaService}'s Redis INCRBY/rollback (needs Redis), and the
 * fail-closed Feign path (needs a stubbed platform-admin). Those are integration concerns and are
 * not faked in a unit test.
 *
 * <p>The default locale is pinned to English for every test: both {@code toLowerCase()} and
 * {@code String.format("%d", ...)} in the code under test read {@code Locale.getDefault()}, so an
 * ambient locale would otherwise decide whether these assertions hold. One test deliberately
 * un-pins it — see {@link TierLookup#turkishDefaultLocaleSilentlyDowngradesEnterpriseToStarter()}.
 */
class TierStorageAndContractTest {

    /** The four limits published in application.yml, in bytes. */
    private static final long TEN_GIB = 10_737_418_240L;          // starter
    private static final long FIFTY_GIB = 53_687_091_200L;        // growth
    private static final long HUNDRED_GIB = 107_374_182_400L;     // custom
    private static final long FIVE_HUNDRED_GIB = 536_870_912_000L; // enterprise

    private Locale originalLocale;

    @BeforeEach
    void pinLocale() {
        originalLocale = Locale.getDefault();
        Locale.setDefault(Locale.ENGLISH);
    }

    @AfterEach
    void restoreLocale() {
        Locale.setDefault(originalLocale);
    }

    // ── Tier → limit ────────────────────────────────────────────────────────────────────────

    @Nested
    class TierLookup {

        private final TierStorageProperties props = new TierStorageProperties();

        @Test
        @DisplayName("the built-in defaults are the four tiers from application.yml, and custom is not unlimited")
        void defaultsMatchThePublishedTierTable() {
            Map<String, Long> limits = props.getLimits();

            assertThat(limits).containsOnlyKeys("starter", "growth", "enterprise", "custom");
            assertThat(limits.get("starter")).isEqualTo(TEN_GIB);
            assertThat(limits.get("growth")).isEqualTo(FIFTY_GIB);
            assertThat(limits.get("custom")).isEqualTo(HUNDRED_GIB);
            assertThat(limits.get("enterprise")).isEqualTo(FIVE_HUNDRED_GIB);

            // "custom" reads like an escape hatch but sits between growth and enterprise. A
            // bespoke-contract tenant gets 100 GiB, not everything.
            assertThat(limits.get("starter"))
                    .isLessThan(limits.get("growth"));
            assertThat(limits.get("growth"))
                    .isLessThan(limits.get("custom"));
            assertThat(limits.get("custom"))
                    .isLessThan(limits.get("enterprise"));
        }

        @Test
        @DisplayName("the tier arrives from platform-admin in UPPERCASE and still resolves")
        void uppercaseTierFromPlatformAdminResolves() {
            // QuotaService.getStorageLimitBytes passes response.data().tier() straight through,
            // and its own fallback literal is "STARTER". If this normalisation ever goes away,
            // every tenant silently drops to the starter limit and uploads start failing at 10 GiB.
            assertThat(props.getLimitForTier("STARTER")).isEqualTo(TEN_GIB);
            assertThat(props.getLimitForTier("GROWTH")).isEqualTo(FIFTY_GIB);
            assertThat(props.getLimitForTier("CUSTOM")).isEqualTo(HUNDRED_GIB);
            assertThat(props.getLimitForTier("ENTERPRISE")).isEqualTo(FIVE_HUNDRED_GIB);
        }

        @Test
        void mixedCaseResolvesToo() {
            assertThat(props.getLimitForTier("Growth")).isEqualTo(FIFTY_GIB);
            assertThat(props.getLimitForTier("eNtErPrIsE")).isEqualTo(FIVE_HUNDRED_GIB);
            assertThat(props.getLimitForTier("starter")).isEqualTo(TEN_GIB);
        }

        @Test
        @DisplayName("a null tier is the starter limit, not zero and not an NPE")
        void nullTierFallsBackToStarter() {
            // Reachable: QuotaService only substitutes "STARTER" when response.data() is null.
            // A tenant row that EXISTS with a null tier column arrives here as null.
            assertThat(props.getLimitForTier(null)).isEqualTo(TEN_GIB);
        }

        @Test
        @DisplayName("an unrecognised tier fails DOWN to starter — never open, never zero")
        void unknownTierFallsBackToStarterNotToUnlimitedAndNotToZero() {
            // The two failure modes that matter are the opposite ends: a typo'd or newly-invented
            // tier must not hand out the enterprise limit, and must not hand out 0 (which would
            // refuse the tenant's very first byte).
            //
            // Note on "Starter ": against the DEFAULT map this one input cannot distinguish a
            // fallback from a successful lookup, because starter's limit IS the fallback. It is
            // kept because 10 GiB is the outcome worth pinning, but the claim that whitespace is
            // not trimmed is proven in whitespaceAroundTheTierIsNotTrimmed, which uses distinct
            // values so the two paths can be told apart.
            for (String unknown : List.of("PLATINUM", "free", "Starter ", "", "  ", "growth\n")) {
                assertThat(props.getLimitForTier(unknown))
                        .as("unrecognised tier %s", "'" + unknown + "'")
                        .isEqualTo(TEN_GIB)
                        .isNotEqualTo(FIVE_HUNDRED_GIB)
                        .isNotZero();
            }
        }

        @Test
        @DisplayName("surrounding whitespace is NOT trimmed, so ' growth ' is silently downgraded")
        void whitespaceAroundTheTierIsNotTrimmed() {
            // Distinct values so the fallback is distinguishable from a successful lookup.
            props.setLimits(new HashMap<>(Map.of("starter", 100L, "growth", 900L)));

            assertThat(props.getLimitForTier("growth")).isEqualTo(900L);
            assertThat(props.getLimitForTier(" growth ")).isEqualTo(100L);
            assertThat(props.getLimitForTier("growth ")).isEqualTo(100L);
        }

        @Test
        @DisplayName("an operator who lowers 'starter' also lowers the unknown-tier fallback")
        void configuredStarterDrivesTheFallbackNotTheConstant() {
            props.setLimits(new HashMap<>(Map.of("starter", 5_000L, "growth", FIFTY_GIB)));

            assertThat(props.getLimitForTier("starter")).isEqualTo(5_000L);
            assertThat(props.getLimitForTier("ENTERPRISE")).isEqualTo(5_000L);
            assertThat(props.getLimitForTier(null)).isEqualTo(5_000L);
        }

        @Test
        @DisplayName("a limits map with no 'starter' key falls back to the hardcoded 10 GiB")
        void limitsWithoutStarterKeyFallBackToTheHardcodedConstant() {
            // Deployment hazard: the yml supplies a partial map (e.g. only the paid tiers), and
            // then every unknown tier is priced off a constant nobody edited.
            props.setLimits(Map.of("growth", 999L));

            assertThat(props.getLimitForTier("PLATINUM")).isEqualTo(TEN_GIB);
            assertThat(props.getLimitForTier(null)).isEqualTo(TEN_GIB);
            assertThat(props.getLimitForTier("growth")).isEqualTo(999L);
        }

        @Test
        @DisplayName("an empty limits map still answers 10 GiB rather than 0")
        void emptyLimitsMapDoesNotRefuseEveryUpload() {
            props.setLimits(new HashMap<>());

            assertThat(props.getLimitForTier("ENTERPRISE")).isEqualTo(TEN_GIB);
            assertThat(props.getLimitForTier("starter")).isEqualTo(TEN_GIB);
        }

        @Test
        @DisplayName("getLimits() hands out the live map — this bean is a singleton, so callers can rewrite quotas")
        void getLimitsExposesTheLiveMapWithNoDefensiveCopy() {
            props.getLimits().put("starter", 1L);

            assertThat(props.getLimitForTier("STARTER")).isEqualTo(1L);
            assertThat(props.getLimitForTier("unknown-tier")).isEqualTo(1L);
        }

        @Test
        @DisplayName("DEFECT PINNED: under a Turkish default locale, ENTERPRISE resolves to the starter limit")
        void turkishDefaultLocaleSilentlyDowngradesEnterpriseToStarter() {
            // getLimitForTier calls tier.toLowerCase() with no Locale. In tr/az, 'I' lowercases to
            // the dotless 'ı', so "ENTERPRISE" becomes "enterprıse", misses the map, and the tenant
            // is quietly re-priced from 500 GiB to 10 GiB — a 50x downgrade with no error anywhere.
            // A container started with -Duser.language=tr is all it takes.
            //
            // This test asserts the CURRENT behaviour so the gap is visible, not so it is blessed.
            // The fix is tier.toLowerCase(Locale.ROOT); when it lands, invert the assertion below
            // to expect FIVE_HUNDRED_GIB and this test becomes the regression guard.
            Locale.setDefault(Locale.forLanguageTag("tr-TR"));

            assumeTrue(!"ENTERPRISE".toLowerCase().equals("enterprise"),
                    "this JDK does not apply Turkish case mapping; nothing to characterise");

            assertThat(props.getLimitForTier("ENTERPRISE"))
                    .isEqualTo(TEN_GIB)
                    .isNotEqualTo(FIVE_HUNDRED_GIB);

            // "STARTER", "GROWTH" and "CUSTOM" contain no 'I', so they survive — which is exactly
            // why this would go unnoticed: only the biggest customers are affected.
            assertThat(props.getLimitForTier("GROWTH")).isEqualTo(FIFTY_GIB);
            assertThat(props.getLimitForTier("CUSTOM")).isEqualTo(HUNDRED_GIB);
        }
    }

    // ── The refusal a tenant actually reads ─────────────────────────────────────────────────

    @Nested
    class QuotaRefusal {

        @Test
        @DisplayName("the message names the quota and both numbers, since it is the entire 409 body")
        void messageCarriesQuotaTypeAndBothNumbers() {
            var ex = new QuotaExceededException("STORAGE_GB", 10_700_000_000L, TEN_GIB);

            assertThat(ex.getMessage()).isEqualTo(
                    "Quota exceeded for STORAGE_GB: used=10700000000 bytes, limit=10737418240 bytes");
            assertThat(ex.getQuotaType()).isEqualTo("STORAGE_GB");
            assertThat(ex.getUsedBytes()).isEqualTo(10_700_000_000L);
            assertThat(ex.getLimitBytes()).isEqualTo(TEN_GIB);
        }

        @Test
        @DisplayName("the reported 'used' EXCLUDES the rejected file, so the message can look like there was room")
        void usedBytesIsUsageBeforeTheRejectedUpload() {
            // Reproduces QuotaService.checkQuota's arithmetic exactly: usedBefore = newTotal - size.
            long limit = TEN_GIB;
            long alreadyStored = TEN_GIB - 1;
            long incomingFile = 100L;
            long newTotal = alreadyStored + incomingFile;      // > limit, so the upload is refused
            long usedBefore = newTotal - incomingFile;

            var ex = new QuotaExceededException("STORAGE_GB", usedBefore, limit);

            assertThat(ex.getUsedBytes()).isEqualTo(alreadyStored);
            // The refusal is correct, but a reader of the message alone computes 1 byte free and
            // concludes the server is wrong. Nothing in the 409 mentions the file's own size.
            assertThat(ex.getUsedBytes()).isLessThan(ex.getLimitBytes());
            assertThat(ex.getMessage())
                    .contains("used=10737418239 bytes", "limit=10737418240 bytes")
                    .doesNotContain(String.valueOf(incomingFile));
        }

        @Test
        @DisplayName("a zero limit is stated as zero rather than swallowed")
        void zeroLimitIsLegible() {
            var ex = new QuotaExceededException("STORAGE_GB", 0L, 0L);

            assertThat(ex.getMessage())
                    .isEqualTo("Quota exceeded for STORAGE_GB: used=0 bytes, limit=0 bytes");
        }

        @Test
        @DisplayName("unchecked, so it propagates out of FileStorageService.upload without a throws clause")
        void isUnchecked() {
            assertThat(QuotaExceededException.class.getSuperclass()).isEqualTo(RuntimeException.class);
        }
    }

    @Nested
    class InvalidImageRefusal {

        @Test
        @DisplayName("extends RuntimeException directly — re-parenting it to ResponseStatusException produced a 500")
        void isNotAResponseStatusException() {
            // The documented incident: as a ResponseStatusException it fell through shared-lib's
            // GlobalExceptionHandler catch-all and the user was told the server had crashed, for a
            // problem they could have fixed by picking a different file. The direct superclass is
            // the thing that must not drift.
            assertThat(InvalidImageException.class.getSuperclass()).isEqualTo(RuntimeException.class);
        }

        @Test
        @DisplayName("the policy's sentence is carried verbatim — punctuation included")
        void carriesThePolicySentenceUnaltered() {
            // ImageUploadPolicy's literal, copied whole — including the em dash and the closing
            // clause. A truncated paraphrase here would still pass (the assertion is a round
            // trip) but would stop being a sample of what the user actually reads.
            String sentence = "That file is not a JPEG, PNG or WebP image. "
                    + "Renaming a file does not change what it is — re-export it as an image.";

            assertThat(new InvalidImageException(sentence).getMessage()).isEqualTo(sentence);
        }
    }

    // ── Status mapping: where the refusal gets its HTTP code ────────────────────────────────

    /**
     * The exceptions carry no status of their own; {@code FileController}'s two local
     * {@code @ExceptionHandler} methods do. They are pure functions of the exception and touch no
     * collaborator, which is why the controller is constructed with nulls here: if a handler ever
     * starts reaching for a service, these tests fail with an NPE and that fact is discovered
     * rather than mocked over.
     */
    @Nested
    class HttpStatusMapping {

        private final FileController controller = new FileController(null, null, null, null);

        @Test
        @DisplayName("quota exceeded → 409, reason delivered as a warning with a null data payload")
        void quotaExceededMapsTo409WithTheReasonInAWarning() {
            var ex = new QuotaExceededException("STORAGE_GB", 10_737_418_239L, TEN_GIB);

            var response = controller.handleQuotaExceeded(ex);

            assertThat(response.getStatusCode().value()).isEqualTo(409);

            var body = response.getBody();
            assertThat(body).isNotNull();
            assertThat(body.data()).isNull();
            assertThat(body.meta()).isNull();
            assertThat(body.warnings()).hasSize(1);

            var warning = body.warnings().get(0);
            assertThat(warning.code()).isEqualTo("QUOTA_EXCEEDED");
            // Verbatim: the handler forwards getMessage(), so the numbers the tenant sees are the
            // numbers QuotaService measured.
            assertThat(warning.message())
                    .isEqualTo("Quota exceeded for STORAGE_GB: used=10737418239 bytes, limit=10737418240 bytes");
        }

        @Test
        @DisplayName("invalid image → 422 INVALID_IMAGE in the ApiError envelope, message unaltered")
        void invalidImageMapsTo422WithThePolicySentence() {
            String sentence = "That file is not a JPEG, PNG or WebP image. "
                    + "Renaming a file does not change what it is — re-export it as an image.";

            var response = controller.handleInvalidImage(new InvalidImageException(sentence));

            // 422, not 400: the multipart request is well formed, the ENTITY is wrong. And not
            // 500, which is what this path returned before the handler existed.
            assertThat(response.getStatusCode().value()).isEqualTo(422);

            var body = response.getBody();
            assertThat(body).isNotNull();
            assertThat(body.error().code()).isEqualTo("INVALID_IMAGE");
            assertThat(body.error().message()).isEqualTo(sentence);
            assertThat(body.error().details()).isEmpty();
            assertThat(body.error().traceId()).isNull();
        }

        @Test
        @DisplayName("the two refusals use different envelopes on purpose — warnings vs error")
        void theTwoRefusalEnvelopesAreNotInterchangeable() {
            // A tidy-up that unified these would change both wire contracts at once: the 409 body
            // has no "error" object for the frontend to read, and the 422 body has no "warnings"
            // array. Pinning the asymmetry so it is a decision, not an accident.
            var quota = controller.handleQuotaExceeded(
                    new QuotaExceededException("STORAGE_GB", 1L, 2L));
            var image = controller.handleInvalidImage(new InvalidImageException("nope"));

            assertThat(quota.getBody()).isNotNull();
            assertThat(quota.getBody().warnings()).isNotEmpty();
            assertThat(image.getBody()).isNotNull();
            assertThat(image.getBody().error().message()).isEqualTo("nope");
        }
    }

    // ── Wire contract of the DTO records ────────────────────────────────────────────────────

    /**
     * A record's component list is simultaneously the JSON field names (camelCase, no naming
     * strategy is configured anywhere in this service) and the canonical constructor's parameter
     * order. Both matter, and the order matters more than it looks: the same-typed String
     * components sit in DIFFERENT positions in the two file records, so copying a constructor call
     * from one to the other compiles and ships garbage.
     */
    @Nested
    class DtoWireContract {

        private List<String> componentsOf(Class<?> record) {
            return Arrays.stream(record.getRecordComponents())
                    .map(RecordComponent::getName)
                    .toList();
        }

        @Test
        @DisplayName("FileUploadResponse: camelCase names in the order the constructor takes them")
        void uploadResponseShape() {
            assertThat(componentsOf(FileUploadResponse.class)).containsExactly(
                    "fileId", "objectKey", "downloadUrl", "sizeBytes", "contentType", "sha256");
        }

        @Test
        @DisplayName("FileMetaResponse: downloadUrl is 6th here but 3rd in FileUploadResponse")
        void metaResponseShape() {
            assertThat(componentsOf(FileMetaResponse.class)).containsExactly(
                    "fileId", "originalFilename", "contentType", "sizeBytes",
                    "sha256", "downloadUrl", "createdAt");

            // The hazard, made explicit: four of these are String, so any permutation of them is
            // a legal call to the canonical constructor.
            assertThat(componentsOf(FileMetaResponse.class))
                    .isNotEqualTo(componentsOf(FileUploadResponse.class));
        }

        @Test
        @DisplayName("QuotaStatusResponse: usedPercent is served pre-computed, next to the two raw numbers")
        void quotaStatusShape() {
            assertThat(componentsOf(QuotaStatusResponse.class))
                    .containsExactly("usedBytes", "limitBytes", "usedPercent");
        }

        @Test
        @DisplayName("accessors return what the canonical constructor was given, in that order")
        void accessorsMapPositionally() {
            // Guards the transposition above at the value level for the record FileController.toMeta
            // builds: distinct, self-identifying strings, so a swap is visible rather than plausible.
            var meta = new FileMetaResponse(
                    java.util.UUID.fromString("11111111-2222-3333-4444-555555555555"),
                    "invoice.png",
                    "image/png",
                    2_048L,
                    "sha-of-the-bytes",
                    "/api/v1/files/11111111-2222-3333-4444-555555555555/download",
                    java.time.Instant.parse("2026-08-22T10:15:30Z"));

            assertThat(meta.originalFilename()).isEqualTo("invoice.png");
            assertThat(meta.contentType()).isEqualTo("image/png");
            assertThat(meta.sha256()).isEqualTo("sha-of-the-bytes");
            assertThat(meta.downloadUrl()).endsWith("/download");
            assertThat(meta.sizeBytes()).isEqualTo(2_048L);
            assertThat(meta.createdAt()).isEqualTo(java.time.Instant.parse("2026-08-22T10:15:30Z"));
        }

        @Test
        @DisplayName("sizeBytes is a primitive long, so a file over 2 GiB does not overflow the contract")
        void sizeBytesIsALongNotAnInt() {
            long threeGib = 3_221_225_472L;

            assertThat(new FileUploadResponse(
                    java.util.UUID.randomUUID(), "k", "/d", threeGib, "application/zip", "sha")
                    .sizeBytes()).isEqualTo(threeGib);

            assertThat(FileUploadResponse.class.getRecordComponents()[3].getType())
                    .isEqualTo(long.class);
            assertThat(QuotaStatusResponse.class.getRecordComponents()[1].getType())
                    .isEqualTo(long.class);
        }
    }
}
