package io.restaurantos.finance.dto;

import java.util.List;

public record ApAgingReportDto(long totalApPaisa, List<ApAgingBucketDto> buckets) {}
