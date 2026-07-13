package io.restaurantos.finance.dto;

import java.util.List;

/** Same shape as ApAgingReportDto (10-18-A) — total + bucket list, so AP/AR share one table component. */
public record ArAgingReportDto(long totalArPaisa, List<ArAgingBucketDto> buckets) {}
