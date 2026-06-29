package io.restaurantos.pos.dto;

import io.restaurantos.pos.service.SplitTenderCalculator;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public record CloseOrderRequest(
        @NotEmpty @Valid List<SplitTenderCalculator.PaymentEntry> payments
) {}
