package io.restaurantos.purchasing.dto;

import io.restaurantos.purchasing.domain.enums.PoStatus;

import java.util.List;
import java.util.UUID;

public record MockReceiveResponse(UUID poId, PoStatus status, List<UUID> grnIds) {}
