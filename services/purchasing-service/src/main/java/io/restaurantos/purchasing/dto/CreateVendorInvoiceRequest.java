package io.restaurantos.purchasing.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record CreateVendorInvoiceRequest(
        UUID purchaseOrderId,
        String invoiceNo,
        LocalDate invoiceDate,
        Long inputTaxPaisa,
        List<Line> lines
) {
    public record Line(UUID poLineId, BigDecimal qty, long unitPricePaisa) {}
}
