package io.restaurantos.purchasing.port;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface GrnDataPort {

    Optional<GrnSummary> getSummary(UUID poLineId);

    record GrnSummary(
            UUID poLineId,
            UUID poId,
            UUID grnId,
            BigDecimal receivedQty,
            BigDecimal orderedQty,
            Instant receivedAt
    ) {}
}
