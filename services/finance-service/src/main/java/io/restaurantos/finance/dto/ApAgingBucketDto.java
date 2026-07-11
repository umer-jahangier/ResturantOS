package io.restaurantos.finance.dto;

public record ApAgingBucketDto(String label, int minDays, int maxDays, long amountPaisa) {}
