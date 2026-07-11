package io.restaurantos.purchasing.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record ApPaymentDto(
        UUID id,
        UUID vendorId,
        UUID branchId,
        LocalDate paymentDate,
        long amountPaisa,
        String bankAccountCode,
        List<AllocationDto> allocations
) {
    public record AllocationDto(UUID invoiceId, long amountPaisa) {}
}
