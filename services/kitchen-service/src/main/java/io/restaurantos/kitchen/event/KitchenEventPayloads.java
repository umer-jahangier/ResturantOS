package io.restaurantos.kitchen.event;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class KitchenEventPayloads {

    private KitchenEventPayloads() {}

    // ─── Produce side ──────────────────────────────────────────────────────────

    public record OrderReadyPayload(UUID orderId, String station, Instant readyAt) {}

    // Field names+order MUST be byte-identical to pos-service's consumer-side
    // KitchenItemStatusConsumer.ItemStatusChangedPayload (field-name parity is the ONLY
    // contract enforcement; a mismatch silently drops every message — RESEARCH.md
    // Pitfall 4 / Phase-7 cold-start bug #4). Never reorder/rename these fields.
    public record ItemStatusChangedPayload(
            UUID orderId,
            UUID orderItemId,
            String newStatus,
            int revisionNo,
            String station
    ) {}

    // ─── Consume side (ORDER_SENT_TO_KDS from pos.topic) ──────────────────────

    // revisionNo/orderNotes/tableNumber are ADDITIVE fields appended after items — names must
    // match pos-service PosEventPayloads.OrderSentToKdsPayload EXACTLY (field-name parity is
    // the only contract enforcement; a mismatch silently drops every message — RESEARCH.md
    // Pitfall 4 / Phase-7 cold-start bug #4). Never reorder/rename the existing fields.
    // tableNumber (KDS-04) is the order's dining-table number, or null for pickup/no-table
    // orders — added 07.3-05, the name MUST stay tableNumber on both sides.
    // orderType is the OrderType enum name (DINE_IN/TAKEAWAY/DELIVERY/PICKUP) — additive
    // trailing field, name MUST match pos-service's producer-side orderType exactly.
    public record OrderSentToKdsPayload(
            UUID orderId,
            UUID tenantId,
            UUID branchId,
            String orderNo,
            List<OrderSentToKdsItem> items,
            int revisionNo,
            String orderNotes,
            String tableNumber,
            String orderType
    ) {
        /**
         * Back-compat constructor for call-sites predating the additive {@code orderType} field
         * (defaults it to null). Jackson always deserializes via the canonical all-args form, so
         * a live event that omits {@code orderType} simply yields null — never this ctor.
         */
        public OrderSentToKdsPayload(UUID orderId, UUID tenantId, UUID branchId, String orderNo,
                List<OrderSentToKdsItem> items, int revisionNo, String orderNotes, String tableNumber) {
            this(orderId, tenantId, branchId, orderNo, items, revisionNo, orderNotes, tableNumber, null);
        }
    }

    // stationId/stationName are ADDITIVE trailing fields (Phase 3 — station routing refactor) —
    // names+order MUST stay byte-identical to pos-service PosEventPayloads.KdsItemPayload; only
    // append, never reorder/rename. kdsStation (the code string) is RETAINED and stays the
    // kitchen's ticket/WS key; stationId is the canonical FK reference (null for a line with no
    // station), stationName the display name used to project a real kds_stations row.
    public record OrderSentToKdsItem(
            UUID orderItemId,
            UUID menuItemId,
            String name,
            int qty,
            String kdsStation,
            List<String> modifiers,
            String notes,
            UUID stationId,
            String stationName
    ) {
        /**
         * Back-compat constructor for call-sites predating the additive {@code stationId}/
         * {@code stationName} fields (defaults both to null). Jackson always deserializes via the
         * canonical all-args form, so a live event that omits them simply yields null — never this
         * ctor. Used by pre-Phase-3 tests/fixtures.
         */
        public OrderSentToKdsItem(UUID orderItemId, UUID menuItemId, String name, int qty,
                String kdsStation, List<String> modifiers, String notes) {
            this(orderItemId, menuItemId, name, qty, kdsStation, modifiers, notes, null, null);
        }
    }

    // ─── Consume side (ORDER_VOIDED from pos.topic) ───────────────────────────

    public record OrderVoidedPayload(UUID orderId, String reason, UUID voidedBy) {}

    // ─── Consume side (ORDER_ITEM_CANCELLED from pos.topic) ───────────────────
    // Mirror of pos PosEventPayloads.OrderItemCancelledPayload. Only orderItemId is needed to
    // locate + strike the KDS line; the other fields travel for context/parity.
    public record OrderItemCancelledPayload(UUID orderId, UUID tenantId, UUID branchId, UUID orderItemId) {}

    // ─── Consume side (ORDER_ITEM_SERVED from pos.topic) ──────────────────────
    // Mirror of pos PosEventPayloads.OrderItemServedPayload (full field parity — the shared
    // ObjectMapper is strict, FAIL_ON_UNKNOWN_PROPERTIES=true). Only orderItemId is needed to
    // locate + serve the KDS line; the other fields travel for context/parity.
    public record OrderItemServedPayload(UUID orderId, UUID tenantId, UUID branchId, UUID orderItemId) {}

    // ─── Consume side (ORDER_CLOSED from pos.topic) ───────────────────────────
    // Deliberate SUBSET of pos PosClosePayloads.OrderClosedPayload (14 fields) — the kitchen only
    // needs orderId to mark the order's tickets SERVED. The shared ObjectMapper is STRICT
    // (FAIL_ON_UNKNOWN_PROPERTIES=true, SharedAutoConfiguration#sharedObjectMapper), so without
    // @JsonIgnoreProperties deserialization throws "Unrecognized field \"orderNo\"" and EVERY
    // ORDER_CLOSED message is dropped — the order's READY tickets then linger on the KDS board
    // instead of being cleared. Unlike the full-parity consumer records above, this one genuinely
    // relies on unknown-field tolerance, so the annotation is REQUIRED here. Guarded by
    // OrderClosedServesTicketsIT (which feeds the real 14-field pos wire shape).
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record OrderClosedPayload(UUID orderId) {}
}
