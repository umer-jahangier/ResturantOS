package io.restaurantos.purchasing.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public record MockReceiveRequest(List<Line> lines) {
    public record Line(UUID poLineId, java.math.BigDecimal receivedQty) {}
}
