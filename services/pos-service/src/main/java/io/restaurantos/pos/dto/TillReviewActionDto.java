package io.restaurantos.pos.dto;

import java.time.Instant;
import java.util.UUID;

public record TillReviewActionDto(
        UUID id,
        UUID tillSessionId,
        UUID reviewerId,
        String action,
        String note,
        Instant actedAt
) {}
