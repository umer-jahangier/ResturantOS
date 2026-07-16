package io.restaurantos.reporting.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * FBR (Federal Board of Revenue, Pakistan) Tax Summary — a named INTERNAL report shaped for FBR
 * bookkeeping. There is no FBR/IRIS e-filing API integration anywhere in the specs and NONE is
 * built here or planned by this plan; this DTO is the source-of-truth numbers a bookkeeper would
 * transcribe into an actual filing, not a filing pipeline itself.
 *
 * <p>All money is {@code Long} paisa (PROJECT.md: never Double/Float/BigDecimal for money).
 * {@code netPayablePaisa} MAY be negative (a legitimate refundable input-tax credit when input tax
 * exceeds output tax for the period) — it is never clamped to zero.
 *
 * <p>{@code ntn}/{@code fbrStrn} are {@code null} (with a {@code dataNotes} entry explaining why)
 * when the branch header lookup to user-service fails — the tax figures are the point of this
 * report; a missing header degrades it, it does not fail it.
 */
public record FbrTaxSummaryDto(
        UUID branchId,
        String branchName,
        String ntn,
        String fbrStrn,
        LocalDate periodFrom,
        LocalDate periodTo,
        long outputTaxPaisa,
        long taxableSalesPaisa,
        long inputTaxPaisa,
        long taxablePurchasesPaisa,
        long netPayablePaisa,
        long salesOrderCount,
        long purchaseInvoiceCount,
        long durationMs,
        List<String> dataNotes) {
}
