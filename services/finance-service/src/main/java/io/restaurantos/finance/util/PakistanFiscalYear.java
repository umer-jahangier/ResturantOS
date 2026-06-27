package io.restaurantos.finance.util;

import java.time.LocalDate;

/** Pakistan fiscal year (Jul–Jun): FY label = calendar year of the June end month. */
public final class PakistanFiscalYear {

    private PakistanFiscalYear() {}

    public static int current() {
        return forDate(LocalDate.now());
    }

    public static int forDate(LocalDate date) {
        return date.getMonthValue() >= 7 ? date.getYear() + 1 : date.getYear();
    }
}
