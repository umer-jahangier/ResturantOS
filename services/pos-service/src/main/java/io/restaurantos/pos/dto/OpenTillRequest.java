package io.restaurantos.pos.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * Open a till session.
 *
 * @param branchId          the branch the drawer belongs to; must equal the caller's JWT branch
 * @param openingFloatPaisa the counted float, in paisa
 * @param cashierId         WHO THE DRAWER IS FOR. Null means "me", which is every cashier's own
 *                          start of shift and the only shape this request had before F11.
 *
 *                          <p>Naming somebody else is the duty manager counting the float into a
 *                          named cashier's drawer and handing it over — the way cash custody
 *                          actually works in a restaurant, and the thing walkthrough §0 found was
 *                          impossible: the field did not exist, so a manager pressing "Open Till"
 *                          opened their OWN drawer while the cashier's terminal still read "No
 *                          active till".
 *
 *                          <p>It is not a free parameter. {@code TillServiceImpl.openTill} requires
 *                          {@code pos.till.open.other} to set it to anything but the caller, and
 *                          requires the target to actually be rostered at this branch with
 *                          {@code pos.till.open}. A cashier sending a colleague's id is refused by
 *                          name.
 */
public record OpenTillRequest(
        @NotNull UUID branchId,
        @Min(0) long openingFloatPaisa,
        UUID cashierId
) {

    /**
     * "Open my own drawer" — the two-argument form every pre-F11 call site uses.
     *
     * <p>Kept as a real constructor rather than making callers pass an explicit null: "for myself"
     * is the overwhelmingly common case and a literal {@code null} at those call sites reads as an
     * omission rather than a decision.
     */
    public OpenTillRequest(UUID branchId, long openingFloatPaisa) {
        this(branchId, openingFloatPaisa, null);
    }
}
