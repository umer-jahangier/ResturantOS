package io.restaurantos.purchasing.dto;

import java.util.UUID;

/**
 * One spend-analytics row (either a vendor or a category bucket) covering the requested period,
 * with a prior-period comparison already computed.
 */
public record SpendBucketDto(
        String label,
        UUID id,
        long spendPaisa,
        long priorSpendPaisa,
        long deltaPaisa,
        Double deltaPct
) {}
