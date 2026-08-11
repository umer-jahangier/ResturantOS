package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.model.ServiceModel;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * Rename and re-scope a terminal. {@code code} is immutable and is not on this record — a device
 * remembers which terminal it is by that handle, so renaming it would silently re-point every
 * screen that stored it. Same reasoning as {@code UpdateStationRequest}.
 *
 * <p>The two scope lists REPLACE what is there. The admin edits a checkbox list and submits what it
 * now says; a full replacement is the honest model of that interaction and is idempotent for free.
 * A null list means "leave this scope alone" — distinct from an empty list, which means "offer
 * everything". Both spellings are needed: an update that only renames must not silently widen the
 * terminal's menu to the whole card.
 */
public record UpdatePosTerminalRequest(
        @NotBlank @Size(max = 100) String name,
        ServiceModel serviceModel,
        OrderType defaultOrderType,
        @Size(max = 200) String printerRef,
        List<UUID> categoryIds,
        List<UUID> stationIds
) {}
