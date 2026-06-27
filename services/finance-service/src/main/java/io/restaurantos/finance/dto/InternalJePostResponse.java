package io.restaurantos.finance.dto;

import java.util.UUID;

/** Response for POST /internal/finance/journal-entries. */
public record InternalJePostResponse(UUID jeId, String entryNo) {}
