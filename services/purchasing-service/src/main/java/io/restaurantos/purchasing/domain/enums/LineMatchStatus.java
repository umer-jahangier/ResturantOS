package io.restaurantos.purchasing.domain.enums;

public enum LineMatchStatus {
    OK,
    QTY_OVER,
    QTY_UNDER,
    PRICE_OVER,
    PRICE_UNDER,
    MISSING_GRN,
    PENDING
}
