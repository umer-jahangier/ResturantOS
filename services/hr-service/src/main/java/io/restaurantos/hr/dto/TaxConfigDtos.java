package io.restaurantos.hr.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Request/response DTOs for the tenant-managed tax configuration (35-06, D-35-05).
 *
 * <p>Field names here are the paths the client binds server errors to, and a slab violation is
 * reported as {@code slabs.2.minPaisa} — dot-indexed, because that is what the web client's binder
 * and its zod resolver both walk. Renaming a field here silently breaks every message that names
 * it, so treat these names as contract.
 *
 * <h2>Every rate is a BigDecimal and every amount is a long of paisa</h2>
 *
 * <p>Not a style choice. {@code TaxSlab.ratePct} was a {@code double} until recently and the income
 * tax slab rate is the single largest deduction on a payslip; an accountant who types {@code 11.500}
 * must have {@code 11.500} applied. A {@code Double} anywhere on this path — including in a
 * request record, where Jackson would happily bind one — reintroduces the defect at the edge.
 */
public final class TaxConfigDtos {

    private TaxConfigDtos() {
    }

    /**
     * One income-tax bracket as the screen sends it.
     *
     * <p>The constraints below are the ones bean validation can express about a slab IN ISOLATION.
     * Everything that requires looking at the neighbouring slabs — contiguity, overlap, starting at
     * zero, exactly one open top — lives in {@code TaxSlabTableValidator}, because a constraint
     * annotation cannot see the rest of the list.
     *
     * @param minPaisa     inclusive lower bound of the bracket, in paisa
     * @param maxPaisa     exclusive upper bound; {@code null} denotes the open-ended top bracket
     * @param baseTaxPaisa tax payable on all income below {@code minPaisa}
     * @param ratePct      percentage applied to the excess over {@code minPaisa}
     */
    public record SlabRequest(
            @NotNull(message = "Enter the income this band starts at")
            @PositiveOrZero(message = "A band cannot start below zero")
            Long minPaisa,

            /** Null on the top band only, and exactly one band may leave it null. */
            @PositiveOrZero(message = "A band cannot end below zero")
            Long maxPaisa,

            @NotNull(message = "Enter the fixed tax for this band (0 if there is none)")
            @PositiveOrZero(message = "Fixed tax cannot be negative")
            Long baseTaxPaisa,

            @NotNull(message = "Enter a rate for this band (0 if this band is untaxed)")
            @DecimalMin(value = "0.000", message = "A tax rate cannot be negative")
            @DecimalMax(value = "100.000", message = "A tax rate cannot exceed 100%")
            @Digits(integer = 3, fraction = 3,
                    message = "A tax rate has at most three decimal places")
            BigDecimal ratePct) {
    }

    /**
     * A whole year's configuration. The fiscal year is a path variable, not a body field: it is the
     * identity of the thing being written, and having it in both places invites them to disagree.
     */
    public record SaveTaxConfigRequest(
            @NotNull(message = "Enter the date this configuration takes effect")
            LocalDate effectiveFrom,

            /** Optional; the last day the configuration applies. */
            LocalDate effectiveTo,

            @NotEmpty(message = "A tax configuration needs at least one income band")
            @Size(max = 20, message = "A tax table has at most 20 bands")
            List<@Valid @NotNull SlabRequest> slabs,

            @NotNull(message = "Enter the income at which surcharge starts (0 for none)")
            @PositiveOrZero(message = "The surcharge threshold cannot be negative")
            Long surchargeThresholdPaisa,

            @NotNull(message = "Enter a surcharge rate (0 if there is none)")
            @DecimalMin(value = "0.000", message = "A surcharge rate cannot be negative")
            @DecimalMax(value = "100.000", message = "A surcharge rate cannot exceed 100%")
            @Digits(integer = 3, fraction = 3,
                    message = "A surcharge rate has at most three decimal places")
            BigDecimal surchargeRatePct,

            @NotNull(message = "Enter the employer EOBI rate")
            @DecimalMin(value = "0.000", message = "An EOBI rate cannot be negative")
            @DecimalMax(value = "100.000", message = "An EOBI rate cannot exceed 100%")
            @Digits(integer = 3, fraction = 3, message = "An EOBI rate has at most three decimal places")
            BigDecimal eobiEmployerRatePct,

            @NotNull(message = "Enter the employee EOBI rate")
            @DecimalMin(value = "0.000", message = "An EOBI rate cannot be negative")
            @DecimalMax(value = "100.000", message = "An EOBI rate cannot exceed 100%")
            @Digits(integer = 3, fraction = 3, message = "An EOBI rate has at most three decimal places")
            BigDecimal eobiEmployeeRatePct,

            @NotNull(message = "Enter the wage the EOBI contribution is calculated on")
            @PositiveOrZero(message = "The EOBI wage base cannot be negative")
            Long eobiWageBasePaisa,

            @NotNull(message = "Choose how a part-month salary is prorated")
            @Size(max = 40)
            String prorationMethod,

            /**
             * Whether payroll should use this configuration. A year can be entered ahead of time
             * and left inactive; payroll refuses an inactive year exactly as it refuses an absent
             * one, which is the point — a half-entered table must not be silently applied.
             */
            @NotNull(message = "Say whether this configuration is in force")
            Boolean active) {
    }

    /** One row of the settings screen's year list. */
    public record TaxConfigSummary(
            UUID id,
            int fiscalYear,
            LocalDate effectiveFrom,
            LocalDate effectiveTo,
            boolean active,
            int bandCount) {
    }

    public record SlabResponse(
            long minPaisa,
            Long maxPaisa,
            long baseTaxPaisa,
            BigDecimal ratePct) {
    }

    /** A whole year's configuration as the screen renders it. */
    public record TaxConfigResponse(
            UUID id,
            int fiscalYear,
            LocalDate effectiveFrom,
            LocalDate effectiveTo,
            List<SlabResponse> slabs,
            long surchargeThresholdPaisa,
            BigDecimal surchargeRatePct,
            BigDecimal eobiEmployerRatePct,
            BigDecimal eobiEmployeeRatePct,
            long eobiWageBasePaisa,
            String prorationMethod,
            boolean active) {
    }

    /**
     * Which fiscal year today falls in, and whether it has been configured.
     *
     * <p>The screen asks the server rather than computing it, so that the July rule has exactly one
     * implementation. {@code configured} is what lets the settings screen open on an empty form with
     * "FY2027 is not configured" rather than on a blank page that looks like a loading failure.
     */
    public record CurrentFiscalYearResponse(
            int fiscalYear,
            LocalDate startsOn,
            LocalDate endsOn,
            boolean configured) {
    }
}
