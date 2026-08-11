package io.restaurantos.hr.payroll.tax;

import java.math.BigDecimal;

/**
 * One cumulative income-tax bracket. {@code maxPaisa == null} denotes the open-ended top slab.
 * All monetary fields are in paisa (1 PKR = 100 paisa). Slab rows live in {@code tax_config}
 * (JSONB), never hardcoded in Java — this record is just their in-memory shape.
 *
 * <p><b>{@code ratePct} is a {@link BigDecimal}, not a double.</b> It was a double, and the earlier
 * pass that moved {@code surchargeRatePct}, {@code eobiEmployerRatePct} and
 * {@code eobiEmployeeRatePct} off floating point missed it — so the income-tax slab rate, which is
 * the single largest deduction on a payslip, was still being applied as
 * {@code Math.round(excess * ratePct / 100.0)}.
 *
 * <p>It has not visibly hurt while the only slab table was one a developer typed as whole numbers.
 * It starts mattering the moment an accountant enters {@code 11.500} through the tax-configuration
 * screen that phase 29 adds — binary floating point cannot represent that exactly, and a payslip
 * that is a paisa out is a payslip an employee disputes.
 *
 * <p>Jackson deserialises JSONB numerics into {@code BigDecimal} without configuration, so the
 * stored slab rows need no migration.
 */
public record TaxSlab(long minPaisa, Long maxPaisa, long baseTaxPaisa, BigDecimal ratePct) {
}
