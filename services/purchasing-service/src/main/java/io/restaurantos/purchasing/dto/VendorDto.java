package io.restaurantos.purchasing.dto;

import java.util.UUID;

public record VendorDto(
        UUID id,
        String name,
        String contactPerson,
        String phone,
        String email,
        String address,
        String paymentTerms,
        String ntn,
        String strn,
        Integer leadTimeDays,
        String bankAccountLast4,
        String notes,
        boolean active
) {}
