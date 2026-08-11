package io.restaurantos.pos.dto;

import java.util.List;

/**
 * A page of the register PLUS the totals for the whole filtered range (37-08).
 *
 * <p>The totals are computed by an aggregate over the entire filtered range, NOT by summing the
 * page. Summing a page gives an owner a number that changes when they turn to page two, which is
 * worse than showing no total at all.
 */
public record TransactionRegisterPage(
        List<TransactionRowDto> rows,
        int page,
        int size,
        long totalRows,
        /** Sum of eventAmountPaisa across the WHOLE filtered range. */
        long netAmountPaisa,
        long tenderedPaisa,
        long refundedPaisa,
        long voidedPaisa
) {}
