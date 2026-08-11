package io.restaurantos.hr;

import io.restaurantos.hr.dto.TaxConfigDtos.CurrentFiscalYearResponse;
import io.restaurantos.hr.dto.TaxConfigDtos.SaveTaxConfigRequest;
import io.restaurantos.hr.dto.TaxConfigDtos.SlabRequest;
import io.restaurantos.hr.dto.TaxConfigDtos.TaxConfigResponse;
import io.restaurantos.hr.dto.TaxConfigDtos.TaxConfigSummary;
import io.restaurantos.hr.exception.TaxConfigNotConfiguredException;
import io.restaurantos.hr.payroll.tax.FiscalYear;
import io.restaurantos.hr.payroll.tax.TaxConfigService;
import io.restaurantos.hr.payroll.tax.TaxSlabTableValidator;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * Payroll's blocker, and the shape of its refusal.
 *
 * <p>Before 35-06, {@code tax_config} held one row for a placeholder tenant for a fiscal year that
 * had already ended, there was no write path in the service or over HTTP, and the absent-year case
 * came back as {@code 500 INTERNAL_ERROR — "An unexpected error occurred"}. These tests hold both
 * halves: that a tenant can enter their own table, and that an absent year is answered by name.
 */
class TaxConfigIT extends HrTestBase {

    @Autowired TaxConfigService taxConfigService;
    @Autowired TenantContext tenantContext;

    // ── the absent year ──────────────────────────────────────────────────────

    @Test
    @DisplayName("payroll's read of an unconfigured year raises the named exception, carrying the year")
    void payrollReadOfAnUnconfiguredYearIsNamed() {
        UUID tenant = UUID.randomUUID();

        TaxConfigNotConfiguredException thrown = as(tenant, () -> catchThrowableOfType(
                TaxConfigNotConfiguredException.class,
                () -> taxConfigService.getActiveConfig(2027)));

        assertThat(thrown).isNotNull();
        assertThat(thrown.getFiscalYear()).isEqualTo(2027);
        assertThat(TaxConfigNotConfiguredException.CODE).isEqualTo("TAX_CONFIG_NOT_CONFIGURED");
    }

    /**
     * The message is the whole point of the exception existing, so it is asserted rather than
     * assumed. It must name the year, must not tell the operator to retry (retrying cannot help),
     * and must not describe the most predictable condition in the subsystem as unexpected.
     */
    @Test
    @DisplayName("the message names the year, says what to do, and never says 'try again' or 'unexpected'")
    void theMessageIsAnInstruction() {
        String message = new TaxConfigNotConfiguredException(2027).getMessage();

        assertThat(message).contains("2027");
        assertThat(message.toLowerCase()).doesNotContain("unexpected");
        assertThat(message.toLowerCase()).doesNotContain("try again");
        assertThat(message.toLowerCase()).doesNotContain("retry");
        // No database vocabulary — the same rule FieldErrorContractTest enforces on shared errors.
        assertThat(message.toLowerCase()).doesNotContain("tax_config");
        assertThat(message.toLowerCase()).doesNotContain("null");
    }

    @Test
    @DisplayName("no fallback: a configured NEIGHBOURING year is never substituted for the missing one")
    void thereIsNoFallbackToAnotherYear() {
        UUID tenant = UUID.randomUUID();
        as(tenant, () -> taxConfigService.save(2026, validRequest(2026, true)));

        // 2026 is configured and active. 2027 is not. A fallback would silently pay everyone at
        // last year's rates, which is a wrong payslip rather than a refused run.
        TaxConfigNotConfiguredException thrown = as(tenant, () -> catchThrowableOfType(
                TaxConfigNotConfiguredException.class,
                () -> taxConfigService.getActiveConfig(2027)));
        assertThat(thrown).isNotNull();
        assertThat(thrown.getFiscalYear()).isEqualTo(2027);
    }

    @Test
    @DisplayName("an INACTIVE year is refused exactly as an absent one — a half-entered table is not applied")
    void anInactiveYearIsRefused() {
        UUID tenant = UUID.randomUUID();
        as(tenant, () -> taxConfigService.save(2027, validRequest(2027, false)));

        assertThat(as(tenant, () -> catchThrowableOfType(TaxConfigNotConfiguredException.class,
                () -> taxConfigService.getActiveConfig(2027)))).isNotNull();

        // ...and activating it makes payroll's read succeed, with no other change.
        as(tenant, () -> taxConfigService.setActive(2027, true));
        assertThat(as(tenant, () -> taxConfigService.getActiveConfig(2027)).slabs()).hasSize(6);
    }

    // ── the write path ───────────────────────────────────────────────────────

    @Test
    @DisplayName("a saved configuration round-trips every column, including the JSONB slab array")
    void savedConfigurationRoundTrips() {
        UUID tenant = UUID.randomUUID();

        TaxConfigResponse saved = as(tenant, () -> taxConfigService.save(2027, validRequest(2027, true)));

        assertThat(saved.id()).isNotNull();
        assertThat(saved.fiscalYear()).isEqualTo(2027);
        assertThat(saved.effectiveFrom()).isEqualTo(LocalDate.of(2026, 7, 1));
        assertThat(saved.effectiveTo()).isEqualTo(LocalDate.of(2027, 6, 30));
        assertThat(saved.active()).isTrue();
        assertThat(saved.prorationMethod()).isEqualTo("CALENDAR_DAYS");
        assertThat(saved.eobiWageBasePaisa()).isEqualTo(3700000L);
        assertThat(saved.surchargeThresholdPaisa()).isEqualTo(1000000000L);

        // Read back through a SECOND call, so the assertion is about what Postgres holds rather
        // than about the in-memory object that was just written.
        TaxConfigResponse reread = as(tenant, () -> taxConfigService.getByFiscalYear(2027));
        assertThat(reread.slabs()).hasSize(6);
        assertThat(reread.slabs().get(0).minPaisa()).isZero();
        assertThat(reread.slabs().get(5).maxPaisa())
                .as("the open top band must survive the JSONB round trip as null")
                .isNull();
    }

    /**
     * The reason {@code TaxSlab.ratePct} stopped being a double. An accountant types 11.500 and
     * 11.500 is what comes back out of NUMERIC(6,3) and JSONB — not 11.499999999999998.
     */
    @Test
    @DisplayName("a three-decimal rate survives the round trip exactly as entered")
    void aThreeDecimalRateSurvivesTheRoundTrip() {
        UUID tenant = UUID.randomUUID();

        List<SlabRequest> slabs = new ArrayList<>(validSlabs());
        slabs.set(2, new SlabRequest(120000000L, 220000000L, 600000L, new BigDecimal("11.500")));
        SaveTaxConfigRequest req = withSlabs(validRequest(2027, true), slabs);

        as(tenant, () -> taxConfigService.save(2027, req));
        TaxConfigResponse reread = as(tenant, () -> taxConfigService.getByFiscalYear(2027));

        assertThat(reread.slabs().get(2).ratePct()).isEqualByComparingTo(new BigDecimal("11.500"));
        assertThat(reread.surchargeRatePct()).isEqualByComparingTo(new BigDecimal("9.000"));
        assertThat(reread.eobiEmployeeRatePct()).isEqualByComparingTo(new BigDecimal("1.000"));
    }

    @Test
    @DisplayName("saving the same year twice edits the one row rather than colliding with itself")
    void savingTwiceIsAnEdit() {
        UUID tenant = UUID.randomUUID();
        TaxConfigResponse first = as(tenant, () -> taxConfigService.save(2027, validRequest(2027, true)));

        SaveTaxConfigRequest changed = withSlabs(validRequest(2027, true), validSlabs());
        TaxConfigResponse second = as(tenant, () -> taxConfigService.save(2027, changed));

        // uk_tax_config_tenant_fy makes (tenant, year) unique; PUT on the year must therefore be
        // create-or-replace, not an insert that trips the constraint on the accountant's second save.
        assertThat(second.id()).isEqualTo(first.id());
        assertThat(as(tenant, taxConfigService::list)).hasSize(1);
    }

    @Test
    @DisplayName("the list is newest year first, marks the active one, and is tenant-scoped")
    void listIsNewestFirstAndTenantScoped() {
        UUID tenant = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        as(tenant, () -> taxConfigService.save(2026, validRequest(2026, false)));
        as(tenant, () -> taxConfigService.save(2027, validRequest(2027, true)));
        as(other, () -> taxConfigService.save(2027, validRequest(2027, true)));

        List<TaxConfigSummary> years = as(tenant, taxConfigService::list);
        assertThat(years).extracting(TaxConfigSummary::fiscalYear).containsExactly(2027, 2026);
        assertThat(years.get(0).active()).isTrue();
        assertThat(years.get(1).active()).isFalse();
        assertThat(years.get(0).bandCount()).isEqualTo(6);

        assertThat(as(other, taxConfigService::list))
                .as("RLS must hide the other tenant's years entirely")
                .hasSize(1);
    }

    @Test
    @DisplayName("fetching an unconfigured year is the named refusal, not an empty success")
    void fetchingAnUnconfiguredYearRefuses() {
        UUID tenant = UUID.randomUUID();
        assertThat(as(tenant, () -> catchThrowableOfType(TaxConfigNotConfiguredException.class,
                () -> taxConfigService.getByFiscalYear(2099)))).isNotNull();
    }

    @Test
    @DisplayName("the current-fiscal-year endpoint agrees with FiscalYear and reports whether it is set up")
    void currentFiscalYearAgreesWithTheOneImplementation() {
        UUID tenant = UUID.randomUUID();

        CurrentFiscalYearResponse before = as(tenant, () -> taxConfigService.currentFiscalYear());
        int expected = FiscalYear.current(java.time.Clock.system(java.time.ZoneId.of("Asia/Karachi")));

        assertThat(before.fiscalYear())
                .as("the screen must not reimplement the July rule; it asks and gets this")
                .isEqualTo(expected);
        assertThat(before.startsOn()).isEqualTo(LocalDate.of(expected - 1, 7, 1));
        assertThat(before.endsOn()).isEqualTo(LocalDate.of(expected, 6, 30));
        assertThat(before.configured()).isFalse();

        as(tenant, () -> taxConfigService.save(expected, validRequest(expected, true)));
        assertThat(as(tenant, () -> taxConfigService.currentFiscalYear()).configured()).isTrue();
    }

    // ── the slab table rules ─────────────────────────────────────────────────

    @Test
    @DisplayName("a first band that does not start at zero names that band's lower bound")
    void firstBandMustStartAtZero() {
        List<SlabRequest> slabs = new ArrayList<>(validSlabs());
        slabs.set(0, new SlabRequest(100L, 60000000L, 0L, new BigDecimal("0.000")));

        assertThat(violationsFor(slabs))
                .contains("slabs.0.minPaisa");
    }

    @Test
    @DisplayName("a gap names the band that begins after it, and says where to start it")
    void aGapNamesTheBandAfterIt() {
        List<SlabRequest> slabs = new ArrayList<>(validSlabs());
        // Band 3 should start at 220,000,000. Start it higher and 2,200,000-2,300,000 rupees of
        // income belongs to no band at all.
        slabs.set(3, new SlabRequest(230000000L, 320000000L, 11600000L, new BigDecimal("23.000")));

        FieldValidationException thrown = thrownFor(slabs);
        assertThat(thrown.getViolations()).extracting(FieldValidationException.Violation::field)
                .contains("slabs.3.minPaisa");
        assertThat(thrown.getViolations().stream()
                .filter(v -> v.field().equals("slabs.3.minPaisa")).findFirst().orElseThrow().instruction())
                .contains("gap");
    }

    @Test
    @DisplayName("an overlap names the overlapping band")
    void anOverlapNamesTheOverlappingBand() {
        List<SlabRequest> slabs = new ArrayList<>(validSlabs());
        slabs.set(2, new SlabRequest(110000000L, 220000000L, 600000L, new BigDecimal("11.000")));

        FieldValidationException thrown = thrownFor(slabs);
        assertThat(thrown.getViolations()).extracting(FieldValidationException.Violation::field)
                .contains("slabs.2.minPaisa");
        assertThat(thrown.getViolations().stream()
                .filter(v -> v.field().equals("slabs.2.minPaisa")).findFirst().orElseThrow().instruction())
                .contains("overlap");
    }

    @Test
    @DisplayName("a table with no open-ended top band names the highest band's upper limit")
    void noOpenTopIsRefused() {
        List<SlabRequest> slabs = new ArrayList<>(validSlabs());
        slabs.set(5, new SlabRequest(410000000L, 999000000L, 61600000L, new BigDecimal("35.000")));

        assertThat(violationsFor(slabs)).contains("slabs.5.maxPaisa");
    }

    @Test
    @DisplayName("two open-ended bands name the lower one, not the plausible top")
    void twoOpenTopsAreRefused() {
        List<SlabRequest> slabs = new ArrayList<>(validSlabs());
        slabs.set(4, new SlabRequest(320000000L, null, 34600000L, new BigDecimal("30.000")));

        List<String> fields = violationsFor(slabs);
        assertThat(fields).contains("slabs.4.maxPaisa");
        assertThat(fields)
                .as("band 5 is the plausible top; blaming it would send the accountant to fix the correct row")
                .doesNotContain("slabs.5.maxPaisa");
    }

    @Test
    @DisplayName("a band ending at or below where it starts names its own upper limit")
    void anInvertedBandIsRefused() {
        List<SlabRequest> slabs = new ArrayList<>(validSlabs());
        slabs.set(1, new SlabRequest(60000000L, 60000000L, 0L, new BigDecimal("1.000")));

        assertThat(violationsFor(slabs)).contains("slabs.1.maxPaisa");
    }

    /**
     * The whole reason for reporting a list rather than the first offender: a six-row editor that
     * reveals its second bad row only after the first is fixed is the experience being removed.
     */
    @Test
    @DisplayName("every violating band is reported at once, each with its own indexed path")
    void everyViolationIsReportedAtOnce() {
        List<SlabRequest> slabs = new ArrayList<>(validSlabs());
        slabs.set(0, new SlabRequest(100L, 60000000L, 0L, new BigDecimal("0.000")));   // not zero
        slabs.set(3, new SlabRequest(230000000L, 320000000L, 11600000L, new BigDecimal("23.000"))); // gap
        slabs.set(5, new SlabRequest(410000000L, 999000000L, 61600000L, new BigDecimal("35.000"))); // no open top

        List<String> fields = violationsFor(slabs);
        assertThat(fields).contains("slabs.0.minPaisa", "slabs.3.minPaisa", "slabs.5.maxPaisa");
    }

    /**
     * Dot-indexed, not bracketed. {@code frontend/lib/forms/server-field-errors.ts} splits a path on
     * "." and walks the form's values; given {@code slabs[3].minPaisa} the first segment matches no
     * key and the message is demoted to a form-level sentence above the table — exactly the "one
     * error and no idea which row" this phase exists to remove.
     */
    @Test
    @DisplayName("slab paths are dot-indexed, because that is the only shape the web client can bind")
    void slabPathsAreDotIndexedNotBracketed() {
        List<SlabRequest> slabs = new ArrayList<>(validSlabs());
        slabs.set(0, new SlabRequest(100L, 60000000L, 0L, new BigDecimal("0.000")));

        assertThat(violationsFor(slabs)).allSatisfy(field -> {
            assertThat(field).doesNotContain("[").doesNotContain("]");
            assertThat(field).matches("slabs\\.\\d+\\.[A-Za-z]+");
        });
    }

    @Test
    @DisplayName("a correct table typed out of order is accepted and stored in order")
    void anOutOfOrderButSoundTableIsAccepted() {
        UUID tenant = UUID.randomUUID();
        List<SlabRequest> shuffled = new ArrayList<>(validSlabs());
        java.util.Collections.reverse(shuffled);

        as(tenant, () -> taxConfigService.save(2027, withSlabs(validRequest(2027, true), shuffled)));

        assertThat(as(tenant, () -> taxConfigService.getByFiscalYear(2027)).slabs())
                .extracting(s -> s.minPaisa())
                .containsExactly(0L, 60000000L, 120000000L, 220000000L, 320000000L, 410000000L);
    }

    // ── copy forward ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("copy-forward returns an UNSAVED draft, inactive, dated for the target year")
    void copyForwardReturnsAnUnsavedDraft() {
        UUID tenant = UUID.randomUUID();
        as(tenant, () -> taxConfigService.save(2026, validRequest(2026, true)));

        SaveTaxConfigRequest draft = as(tenant, () -> taxConfigService.copyForward(2026, 2027));

        assertThat(draft.slabs()).hasSize(6);
        assertThat(draft.effectiveFrom()).isEqualTo(LocalDate.of(2026, 7, 1));
        assertThat(draft.effectiveTo()).isEqualTo(LocalDate.of(2027, 6, 30));
        assertThat(draft.active())
                .as("a pre-activated draft would be in force from the moment it was saved, read or not")
                .isFalse();

        // And nothing was written. Silently creating next year's table from last year's rates is how
        // a rate superseded by a Finance Act survives into a year it does not apply to.
        assertThat(as(tenant, taxConfigService::list))
                .extracting(TaxConfigSummary::fiscalYear).containsExactly(2026);
    }

    @Test
    @DisplayName("copy-forward from a year with no configuration names the SOURCE year")
    void copyForwardFromAnAbsentYearNamesTheSourceYear() {
        UUID tenant = UUID.randomUUID();

        TaxConfigNotConfiguredException thrown = as(tenant, () -> catchThrowableOfType(
                TaxConfigNotConfiguredException.class,
                () -> taxConfigService.copyForward(2025, 2027)));

        assertThat(thrown).isNotNull();
        assertThat(thrown.getFiscalYear())
                .as("naming the target year would send the accountant to look at the wrong one")
                .isEqualTo(2025);
    }

    // ── authorisation ────────────────────────────────────────────────────────

    @Test
    @DisplayName("reading needs view; writing needs manage")
    void readsAndWritesHaveDifferentPermissions() {
        UUID tenant = UUID.randomUUID();
        as(tenant, () -> taxConfigService.save(2027, validRequest(2027, true)));

        UUID branch = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            // A branch manager: may read the tax table, may not rewrite it. This is the endpoint
            // 35-03's two-code split exists for.
            withPermissions(tenant, branch, List.of("hr.config.view", "hr.employee.manage"));

            assertThat(taxConfigService.list()).hasSize(1);
            assertThatThrownBy(() -> taxConfigService.save(2027, validRequest(2027, true)))
                    .isInstanceOf(PermissionDeniedException.class);
            assertThatThrownBy(() -> taxConfigService.setActive(2027, false))
                    .isInstanceOf(PermissionDeniedException.class);
        } finally {
            SecurityContextHolder.clearContext();
            tenantContext.clear();
        }
    }

    @Test
    @DisplayName("another tenant can neither read nor write this tenant's configuration")
    void crossTenantIsRefused() {
        UUID owner = UUID.randomUUID();
        as(owner, () -> taxConfigService.save(2027, validRequest(2027, true)));

        UUID intruder = UUID.randomUUID();
        assertThat(as(intruder, taxConfigService::list))
                .as("RLS must hide another tenant's configuration entirely")
                .isEmpty();

        // The read of a specific year is not "forbidden" but "does not exist for you" — which is
        // the correct disclosure: an intruder learns nothing about whether that year is configured.
        assertThat(as(intruder, () -> catchThrowableOfType(TaxConfigNotConfiguredException.class,
                () -> taxConfigService.getByFiscalYear(2027)))).isNotNull();
        assertThat(as(intruder, () -> catchThrowableOfType(TaxConfigNotConfiguredException.class,
                () -> taxConfigService.setActive(2027, false)))).isNotNull();
    }

    // ── fixtures ─────────────────────────────────────────────────────────────

    /** The seeded FY2026 table: contiguous, starting at zero, one open top. */
    private static List<SlabRequest> validSlabs() {
        return List.of(
                new SlabRequest(0L, 60000000L, 0L, new BigDecimal("0.000")),
                new SlabRequest(60000000L, 120000000L, 0L, new BigDecimal("1.000")),
                new SlabRequest(120000000L, 220000000L, 600000L, new BigDecimal("11.000")),
                new SlabRequest(220000000L, 320000000L, 11600000L, new BigDecimal("23.000")),
                new SlabRequest(320000000L, 410000000L, 34600000L, new BigDecimal("30.000")),
                new SlabRequest(410000000L, null, 61600000L, new BigDecimal("35.000")));
    }

    private static SaveTaxConfigRequest validRequest(int fiscalYear, boolean active) {
        return new SaveTaxConfigRequest(
                LocalDate.of(fiscalYear - 1, 7, 1),
                LocalDate.of(fiscalYear, 6, 30),
                validSlabs(),
                1000000000L,
                new BigDecimal("9.000"),
                new BigDecimal("5.000"),
                new BigDecimal("1.000"),
                3700000L,
                "CALENDAR_DAYS",
                active);
    }

    private static SaveTaxConfigRequest withSlabs(SaveTaxConfigRequest base, List<SlabRequest> slabs) {
        return new SaveTaxConfigRequest(base.effectiveFrom(), base.effectiveTo(), slabs,
                base.surchargeThresholdPaisa(), base.surchargeRatePct(), base.eobiEmployerRatePct(),
                base.eobiEmployeeRatePct(), base.eobiWageBasePaisa(), base.prorationMethod(),
                base.active());
    }

    /** Runs the table through the validator directly — the rules are pure and need no tenant. */
    private static FieldValidationException thrownFor(List<SlabRequest> slabs) {
        FieldValidationException thrown = catchThrowableOfType(FieldValidationException.class,
                () -> TaxSlabTableValidator.validate(slabs));
        assertThat(thrown).as("this table must be refused").isNotNull();
        assertThat(thrown.getCode()).isEqualTo("TAX_SLABS_INVALID");
        return thrown;
    }

    private static List<String> violationsFor(List<SlabRequest> slabs) {
        return thrownFor(slabs).getViolations().stream()
                .map(FieldValidationException.Violation::field).toList();
    }

    private <T> T as(UUID tenantId, java.util.function.Supplier<T> action) {
        tenantContext.set(tenantId, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            return action.get();
        } finally {
            tenantContext.clear();
        }
    }

    private void as(UUID tenantId, Runnable action) {
        as(tenantId, () -> {
            action.run();
            return null;
        });
    }

    private static void withPermissions(UUID tenantId, UUID branchId, List<String> permissions) {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("MANAGER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }
}
