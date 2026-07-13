package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.ArTxnType;
import io.restaurantos.finance.domain.model.ArTransaction;
import io.restaurantos.finance.dto.ArAgingBucketDto;
import io.restaurantos.finance.dto.ArAgingReportDto;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Decision 10-18-A: AR aging mirrors AP aging's exact bucket boundaries
 * (Current 0-30 / 31-60 / 61-90 / Over 90+) so the two reports are comparable, and
 * settlements are allocated FIFO oldest-charge-first. Pure, no Spring wiring beyond
 * @Component, no DB access — unit-testable in isolation.
 */
@Component
public class ArAgingCalculator {

    public ArAgingReportDto age(List<ArTransaction> txns, LocalDate asOf) {
        Map<UUID, List<ArTransaction>> byAccount = new LinkedHashMap<>();
        for (ArTransaction txn : txns) {
            byAccount.computeIfAbsent(txn.getCustomerAccountId(), k -> new ArrayList<>()).add(txn);
        }

        long current = 0;
        long days31to60 = 0;
        long days61to90 = 0;
        long over90 = 0;

        for (List<ArTransaction> accountTxns : byAccount.values()) {
            List<ArTransaction> charges = accountTxns.stream()
                    .filter(t -> t.getTxnType() == ArTxnType.CHARGE)
                    .sorted(Comparator.comparing(ArTransaction::getTxnDate))
                    .toList();
            long settlementPool = accountTxns.stream()
                    .filter(t -> t.getTxnType() == ArTxnType.SETTLEMENT)
                    .mapToLong(ArTransaction::getAmountPaisa)
                    .sum();

            for (ArTransaction charge : charges) {
                long remainder = charge.getAmountPaisa();
                if (settlementPool > 0) {
                    long applied = Math.min(settlementPool, remainder);
                    remainder -= applied;
                    settlementPool -= applied;
                }
                // Overpayment surplus (settlementPool left over) is clamped out of the
                // buckets — it reduces the account's effective outstanding total but must
                // never produce a negative bucket.
                if (remainder <= 0) {
                    continue;
                }

                long age = ChronoUnit.DAYS.between(charge.getTxnDate(), asOf);
                if (age <= 30) {
                    current += remainder;
                } else if (age <= 60) {
                    days31to60 += remainder;
                } else if (age <= 90) {
                    days61to90 += remainder;
                } else {
                    over90 += remainder;
                }
            }
        }

        long total = current + days31to60 + days61to90 + over90;
        return new ArAgingReportDto(total, List.of(
                new ArAgingBucketDto("Current", 0, 30, current),
                new ArAgingBucketDto("31-60 days", 31, 60, days31to60),
                new ArAgingBucketDto("61-90 days", 61, 90, days61to90),
                new ArAgingBucketDto("Over 90 days", 91, Integer.MAX_VALUE, over90)));
    }
}
