package io.restaurantos.purchasing.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Money leaving a bank account. Unconstrained until now, despite the controller's {@code @Valid} —
 * a payment with no amount or no invoice reached the posting path and came back 500 rather than
 * telling the caller what was missing.
 */
public record CreateApPaymentRequest(
        @NotNull UUID invoiceId,
        @NotNull(message = "Payment date is required") LocalDate paymentDate,
        @NotNull @Positive(message = "Payment amount must be greater than zero") Long amountPaisa,
        @NotBlank(message = "A bank account code is required") String bankAccountCode
) {}
