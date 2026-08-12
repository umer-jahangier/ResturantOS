package io.restaurantos.pos.ws;

import java.time.Instant;
import java.util.UUID;

/**
 * The "the menu just changed, re-read it" frame pushed down the existing per-branch POS order
 * WebSocket.
 *
 * <h2>Why this is an envelope when the order frames are not</h2>
 *
 * <p>The socket already carries bare {@code OrderDto} JSON with no wrapper, and that contract is
 * consumed today. Rather than break it, this frame is discriminated by a field an
 * {@code OrderDto} can never have: {@code event}. Note {@code OrderDto} DOES have a field called
 * {@code type} (the {@code OrderType} enum), which is exactly why {@code type} is the wrong
 * discriminator here — a future {@code OrderType} value could collide, {@code event} cannot.
 * The client checks {@code "event" in frame} first and only then falls through to the order path.
 *
 * <h2>Why it carries no menu payload</h2>
 *
 * <p>It is a cache-invalidation signal, not a menu delta. Menu visibility is the resultant of
 * item active + category active + branch override + the caller's own permissions, and no single
 * push can be trusted to reproduce that for every subscriber. The till re-reads
 * {@code GET /menu/items} — the one query that already computes it — and the frame's job is only
 * to say when. {@code itemName}/{@code active} ride along purely so the terminal can TELL the
 * cashier what changed ("Butter Naan is no longer available"); nothing on the client derives
 * visibility from them.
 *
 * @param event     always {@value #EVENT} — the discriminator.
 * @param tenantId  the tenant whose menu changed. Menu items and categories are TENANT-scoped,
 *                  so this reaches every branch's terminals, not just the acting one.
 * @param change    what happened, for the log and for the terminal's wording. See the constants.
 * @param itemId    the item, when the change is item-scoped; null for category-scoped changes.
 * @param itemName  human name at the moment of the change — for the cashier's toast only.
 * @param active    the item's new active flag; null when not an activation change.
 * @param at        server time of the change.
 */
public record MenuChangedFrame(
        String event,
        UUID tenantId,
        String change,
        UUID itemId,
        String itemName,
        Boolean active,
        Instant at
) {

    public static final String EVENT = "menu.changed";

    public static final String ITEM_CREATED = "item.created";
    public static final String ITEM_UPDATED = "item.updated";
    public static final String ITEM_ACTIVATED = "item.activated";
    public static final String ITEM_DEACTIVATED = "item.deactivated";
    public static final String ITEM_DELETED = "item.deleted";
    public static final String CATEGORY_CHANGED = "category.changed";

    public static MenuChangedFrame item(UUID tenantId, String change, UUID itemId,
                                        String itemName, Boolean active) {
        return new MenuChangedFrame(EVENT, tenantId, change, itemId, itemName, active, Instant.now());
    }

    public static MenuChangedFrame category(UUID tenantId) {
        return new MenuChangedFrame(EVENT, tenantId, CATEGORY_CHANGED, null, null, null, Instant.now());
    }
}
