package io.restaurantos.purchasing.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateVendorRequest(
        @NotBlank String name,
        String contactPerson,
        String phone,
        String email,
        String address,
        @NotBlank String paymentTerms,
        String ntn,
        String strn,
        Integer leadTimeDays,
        String bankAccountNo,
        String notes
) {}
