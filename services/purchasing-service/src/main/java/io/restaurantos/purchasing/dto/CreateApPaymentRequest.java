package io.restaurantos.purchasing.dto;

import java.time.LocalDate;
import java.util.UUID;

public record CreateApPaymentRequest(
        UUID invoiceId,
        LocalDate paymentDate,
        Long amountPaisa,
        String bankAccountCode
) {}
