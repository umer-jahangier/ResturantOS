package io.restaurantos.inventory.event;

import java.time.Instant;
import java.util.UUID;

/**
 * The pos→inventory menu-item catalog contract, and nothing else.
 *
 * <p>Everything this class used to hold — the inbound ORDER_CLOSED shape and every outbound
 * {@code inventory.topic} payload — now lives in {@code shared-lib} as
 * {@link io.restaurantos.shared.event.payload.PosEventContract} and
 * {@link io.restaurantos.shared.event.payload.InventoryEventContract}, so producer and consumer
 * compile against ONE definition instead of two copies kept in step by a comment. That comment
 * did not hold: finance-service read {@code variancePaisa} and {@code costPaisa} for fields
 * published as {@code varianceCostPaisa} and {@code unitCostPaisa}, and both seams posted nothing
 * for months without raising an error.
 *
 * <p>MENU_ITEM_UPSERTED/DELETED stay here on purpose. They are a two-party contract between
 * pos-service and this service with parity ITs on both ends, they have never drifted, and moving
 * them would be churn without a defect behind it.
 */
public final class InventoryEventPayloads {

    private InventoryEventPayloads() {}

    // ─── Consume side (MENU_ITEM_UPSERTED/MENU_ITEM_DELETED from pos.topic) ────
    // D-02: field-name + order parity with pos-service's PosEventPayloads
    // MenuItemUpsertedPayload/MenuItemDeletedPayload (08.1-01) — the cross-service contract.

    public static final String MENU_ITEM_UPSERTED = "MENU_ITEM_UPSERTED";
    public static final String MENU_ITEM_DELETED = "MENU_ITEM_DELETED";

    public record MenuItemUpsertedPayload(
            UUID menuItemId,
            String name,
            UUID categoryId,
            String categoryName,
            boolean active,
            long basePricePaisa,
            Instant updatedAt
    ) {}

    public record MenuItemDeletedPayload(UUID menuItemId) {}
}
