package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.model.ServiceModel;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * Create a POS terminal under the caller's branch.
 *
 * <p>Both scope lists are optional and an omitted or empty list means <b>everything</b> — the whole
 * menu, every station. That is the do-nothing configuration and it must produce exactly today's
 * behaviour, so it cannot be a validation error and it cannot be a flag.
 */
public record CreatePosTerminalRequest(
        @NotBlank @Size(max = 50) String code,
        @NotBlank @Size(max = 100) String name,
        ServiceModel serviceModel,
        OrderType defaultOrderType,
        @Size(max = 200) String printerRef,
        List<UUID> categoryIds,
        List<UUID> stationIds
) {
    public ServiceModel serviceModelOrDefault() {
        return serviceModel != null ? serviceModel : ServiceModel.DEFAULT;
    }

    public List<UUID> categoryIdsOrEmpty() {
        return categoryIds != null ? categoryIds : List.of();
    }

    public List<UUID> stationIdsOrEmpty() {
        return stationIds != null ? stationIds : List.of();
    }
}
