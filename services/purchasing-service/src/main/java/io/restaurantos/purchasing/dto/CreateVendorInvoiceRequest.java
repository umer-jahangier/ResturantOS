package io.restaurantos.purchasing.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A vendor's invoice, booked against a purchase order for three-way matching.
 *
 * <p>Every field here was previously unconstrained despite the controller's {@code @Valid}, so
 * {@code POST /invoices} with an empty body reached the matching logic and failed there — 500
 * INTERNAL_ERROR for what is plainly a malformed request. This is the document that becomes an AP
 * liability and a journal entry; it is the last place to accept a null.
 */
public record CreateVendorInvoiceRequest(
        @NotNull UUID purchaseOrderId,
        @NotBlank(message = "Invoice number is required") String invoiceNo,
        @NotNull(message = "Invoice date is required") LocalDate invoiceDate,
        @PositiveOrZero(message = "Input tax cannot be negative") Long inputTaxPaisa,
        @NotEmpty(message = "An invoice must have at least one line") @Valid List<Line> lines
) {
    public record Line(
            @NotNull UUID poLineId,
            @NotNull @Positive(message = "Invoiced quantity must be greater than zero") BigDecimal qty,
            @PositiveOrZero(message = "Unit price cannot be negative") long unitPricePaisa) {}
}
