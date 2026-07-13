package io.restaurantos.purchasing.dto;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.enums.LineMatchStatus;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record VendorInvoiceDto(
        UUID id,
        UUID vendorId,
        UUID purchaseOrderId,
        UUID branchId,
        String invoiceNo,
        LocalDate invoiceDate,
        InvoiceStatus status,
        long totalPaisa,
        long inputTaxPaisa,
        String matchOverrideReason,
        List<LineDto> lines
) {
    public record LineDto(
            UUID id,
            UUID poLineId,
            BigDecimal qty,
            long unitPricePaisa,
            long lineTotalPaisa,
            LineMatchStatus matchStatus
    ) {}
}
