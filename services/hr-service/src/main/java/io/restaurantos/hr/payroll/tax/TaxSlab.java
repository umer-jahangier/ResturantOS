package io.restaurantos.hr.payroll.tax;

/**
 * One cumulative income-tax bracket. {@code maxPaisa == null} denotes the open-ended top slab.
 * All monetary fields are in paisa (1 PKR = 100 paisa). Slab rows live in {@code tax_config}
 * (JSONB), never hardcoded in Java — this record is just their in-memory shape.
 */
public record TaxSlab(long minPaisa, Long maxPaisa, long baseTaxPaisa, double ratePct) {
}
