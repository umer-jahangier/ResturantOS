package io.restaurantos.purchasing.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * One item that needs ordering, joined to the supplier who sells it.
 *
 * <p>Two quantities, deliberately both present. {@code shortfallQty} is what the shelf is missing,
 * in the STOCK unit ("15 kg"). {@code orderQty} is what you actually buy, in the supplier's ORDER
 * unit after pack size, minimum order and order multiple are applied ("2 cases"). Showing only the
 * second hides why it is bigger than you expected; showing only the first is not orderable.
 *
 * <p>{@code blockedReason} non-null means this row cannot become a PO line as it stands — no
 * supplier, several suppliers, no price, or no par level upstream. It is still returned, because a
 * list that silently drops what it cannot solve reads as "everything else is fine".
 */
public record OrderSuggestionDto(
        UUID ingredientId,
        String ingredientName,
        String sku,
        String categoryName,

        BigDecimal qtyOnHand,
        BigDecimal reorderPoint,
        BigDecimal parLevel,
        String stockUom,
        BigDecimal shortfallQty,

        UUID vendorId,
        String vendorName,
        UUID vendorItemId,
        String vendorSku,
        String packDescription,
        String orderUom,
        BigDecimal orderQty,
        Long unitPricePaisa,
        Long lineTotalPaisa,
        Integer leadTimeDays,

        String blockedReason) {

    /** True when this row can be turned into a purchase-order line exactly as it stands. */
    public boolean orderable() {
        return blockedReason == null && vendorItemId != null && orderQty != null;
    }

    /**
     * Suggestions for one branch, already grouped the way they will be ordered — one group per
     * vendor, because a purchase order goes to exactly one supplier. Grouping in the response
     * rather than in the browser keeps the "create these POs" call a straight mapping of what the
     * user saw.
     */
    public record VendorGroup(
            UUID vendorId,
            String vendorName,
            Integer leadTimeDays,
            long estimatedTotalPaisa,
            List<OrderSuggestionDto> lines) {}

    /**
     * {@code unassigned} holds every row that could not be attached to a vendor group — each with
     * its own {@code blockedReason}. {@code blockedCount} is its size, surfaced separately so a
     * filtered UI never has to recount.
     */
    public record OrderSuggestionsResponse(
            UUID branchId,
            List<VendorGroup> vendorGroups,
            List<OrderSuggestionDto> unassigned,
            int blockedCount,
            long estimatedTotalPaisa) {}

    /**
     * Turn accepted suggestions into draft purchase orders.
     *
     * <p>The caller sends the {@code vendorItemId} + {@code qty} pairs it is accepting, NOT a
     * "create everything you suggested" flag. Suggestions are recomputed on every read — stock
     * moves, prices change — so acting on a server-side recomputation would order whatever was true
     * at click time rather than what the buyer reviewed. Sending the reviewed numbers back is what
     * makes the order match the screen.
     *
     * <p>They land as DRAFT, never submitted. The existing approval flow is unchanged and still
     * applies; a suggestion is a starting point for a buyer, not an authority to spend.
     */
    public record CreateFromSuggestionsRequest(
            UUID branchId,
            List<AcceptedLine> lines) {

        public record AcceptedLine(UUID vendorItemId, java.math.BigDecimal qty) {}
    }
}
