package io.restaurantos.pos.dto;

import jakarta.validation.constraints.Size;

import java.util.Map;
import java.util.UUID;

/**
 * PATCH body for editing order-level and per-item special instructions after creation
 * (POS-13). Both fields are optional/partial-update: a null {@code notes} leaves the
 * order-level note unchanged; a null/absent entry in {@code itemNotes} leaves that
 * line's note unchanged. Char limits mirror UI-SPEC (240 order-level / 140 per-item) and
 * are enforced server-side (RESEARCH.md Security Domain V5) — both here (MVC-layer
 * {@code @Valid} defense) and explicitly in {@code OrderServiceImpl.updateInstructions}
 * (service-layer defense, exercised by direct-service-call ITs that bypass the MVC layer).
 */
public record UpdateInstructionsRequest(
        @Size(max = 240, message = "Order notes must not exceed 240 characters") String notes,
        Map<UUID, String> itemNotes
) {
    public static final int ORDER_NOTES_MAX_LENGTH = 240;
    public static final int ITEM_NOTES_MAX_LENGTH = 140;
}
