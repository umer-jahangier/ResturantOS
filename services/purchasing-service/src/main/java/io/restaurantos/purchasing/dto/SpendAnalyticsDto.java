package io.restaurantos.purchasing.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** PUR-06: period spend report aggregated by vendor and by category, with a prior-period comparison. */
public record SpendAnalyticsDto(
        UUID branchId,
        LocalDate from,
        LocalDate to,
        LocalDate compareFrom,
        LocalDate compareTo,
        List<SpendBucketDto> byVendor,
        List<SpendBucketDto> byCategory
) {}
