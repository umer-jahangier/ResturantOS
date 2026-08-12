package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.TillReviewStatus;
import io.restaurantos.pos.domain.enums.TillStatus;

import java.time.Instant;
import java.util.UUID;

/**
 * One till session, as Till Review reads it.
 *
 * <p>F21: {@code cashierName} closes the same defect on this screen that F2 closed on Order
 * Management. The Cashier column rendered {@code cashierId.slice(0, 8)} — a nine-row table read
 * "4fdc85ef", "4b9941f7", "eb2ee67e" where seven different people belonged. This is the screen a
 * manager reconciles cash on and approves or flags a variance from, so "whose drawer was Rs 200
 * short" is the question it exists to answer, and it could not be answered without cross-referencing
 * ids by hand.
 *
 * <p>F11 sharpened it: a duty manager may now open drawers for several NAMED cashiers in a row
 * (they pick them out of a picker that shows names), and then could not tell those rows apart
 * afterwards.
 *
 * <p>Resolved server-side rather than in the browser for the reason spelled out on
 * {@link io.restaurantos.pos.feign.AuthUserDirectoryClient}: {@code GET /api/v1/users} answers 403
 * for a branch manager, so a client-side lookup would mean widening a permission to make a column
 * render. {@code pos.till.open} — which the caller already holds — is enough to read a till, and
 * whose drawer it was is a property of that till.
 *
 * <p>{@code cashierName} is <b>decoration and is nullable</b>: when the staff directory cannot be
 * reached it stays null and the client falls back to {@code cashierId}, never to a blank, which
 * would read as "nobody". {@code cashierId} is the fact; the name is the courtesy. Populated for
 * every endpoint that returns a till, because they all funnel through {@code TillServiceImpl.toDto}
 * — including approve/flag/note, so a row does not snap back to a UUID the moment a manager acts
 * on it.
 */
public record TillSessionDto(
        UUID id,
        UUID branchId,
        UUID cashierId,
        String cashierName,
        long openingFloatPaisa,
        Long expectedClosingPaisa,
        Long declaredClosingPaisa,
        Long variancePaisa,
        TillStatus status,
        Instant openedAt,
        Instant closedAt,
        String note,
        TillReviewStatus reviewStatus
) {

    /** This session with its cashier's display name attached. Records are immutable; this is the copy. */
    public TillSessionDto withCashierName(String name) {
        return new TillSessionDto(id, branchId, cashierId, name, openingFloatPaisa,
                expectedClosingPaisa, declaredClosingPaisa, variancePaisa, status,
                openedAt, closedAt, note, reviewStatus);
    }
}
