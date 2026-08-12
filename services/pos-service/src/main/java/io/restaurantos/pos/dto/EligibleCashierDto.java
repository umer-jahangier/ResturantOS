package io.restaurantos.pos.dto;

import java.util.UUID;

/**
 * One person a duty manager may open a drawer for at this branch (F11).
 *
 * @param userId      who to name in {@code POST /api/v1/pos/tills}
 * @param name        the label to show — full name, falling back to the login address
 * @param email       the login address, shown as the disambiguator when two people share a name
 * @param roleCode    their role AT THIS BRANCH; a person can hold different roles at different
 *                    branches, so it is meaningless without the branch
 * @param hasOpenTill whether they ALREADY hold an open drawer. Carried so the picker can say so
 *                    before the manager counts a float — the alternative is a 409 after the fact,
 *                    which is the moment the cash is already on the counter.
 */
public record EligibleCashierDto(
        UUID userId,
        String name,
        String email,
        String roleCode,
        boolean hasOpenTill
) {}
