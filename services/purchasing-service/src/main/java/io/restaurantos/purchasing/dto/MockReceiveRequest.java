package io.restaurantos.purchasing.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Which PO lines arrived, and how much of each.
 *
 * <p>The constraints are not decoration. {@code GrnReceiptSimulator} iterates {@code lines}
 * directly, so a body without them dereferenced null and returned 500 INTERNAL_ERROR — a caller
 * who omitted a field was told the server had broken. A null {@code receivedQty} reached the
 * quantity arithmetic the same way, and a negative one would have posted a NEGATIVE goods receipt:
 * stock removed, a GR/IR journal entry raised against it, and nothing anywhere flagging it as
 * anything other than a delivery.
 */
public record MockReceiveRequest(
        @NotEmpty(message = "At least one line is required") @Valid List<Line> lines
) {
    public record Line(
            @NotNull UUID poLineId,
            @NotNull @Positive(message = "Received quantity must be greater than zero")
            BigDecimal receivedQty) {}
}
