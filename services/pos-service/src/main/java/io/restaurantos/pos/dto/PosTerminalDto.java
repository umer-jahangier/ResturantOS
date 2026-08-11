package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.model.PosTerminal;
import io.restaurantos.pos.domain.model.ServiceModel;

import java.util.List;
import java.util.UUID;

/**
 * Read model for a POS terminal profile (D-28-03).
 *
 * <p>{@code categoryIds} empty means the terminal offers EVERY category and {@code stationIds}
 * empty means it fires to EVERY station. {@link #offersWholeMenu()} and {@link #firesToAllStations()}
 * exist so no consumer has to re-derive that from a list length and, more importantly, so the
 * browser can render "offers the whole menu" in those words rather than showing an empty list the
 * admin has to interpret.
 */
public record PosTerminalDto(
        UUID id,
        UUID branchId,
        String code,
        String name,
        ServiceModel serviceModel,
        OrderType defaultOrderType,
        String printerRef,
        boolean active,
        List<UUID> categoryIds,
        List<UUID> stationIds,
        boolean offersWholeMenu,
        boolean firesToAllStations
) {
    public static PosTerminalDto from(PosTerminal t, List<UUID> categoryIds, List<UUID> stationIds) {
        return new PosTerminalDto(
                t.getId(), t.getBranchId(), t.getCode(), t.getName(),
                t.getServiceModel(), t.getDefaultOrderType(), t.getPrinterRef(), t.isActive(),
                List.copyOf(categoryIds), List.copyOf(stationIds),
                categoryIds.isEmpty(), stationIds.isEmpty());
    }
}
