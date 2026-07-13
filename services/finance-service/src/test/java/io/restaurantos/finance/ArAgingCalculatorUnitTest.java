package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.ArTxnType;
import io.restaurantos.finance.domain.model.ArTransaction;
import io.restaurantos.finance.dto.ArAgingReportDto;
import io.restaurantos.finance.service.ArAgingCalculator;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pure JUnit — no Spring context, no container. Proves FIFO settlement allocation and the
 * AP-mirrored bucket boundaries (decision 10-18-A): Current 0-30 / 31-60 / 61-90 / Over 90.
 */
class ArAgingCalculatorUnitTest {

    private final ArAgingCalculator calculator = new ArAgingCalculator();
    private static final LocalDate AS_OF = LocalDate.of(2026, 7, 13);

    private ArTransaction charge(UUID accountId, LocalDate txnDate, long amountPaisa) {
        ArTransaction txn = new ArTransaction();
        txn.setCustomerAccountId(accountId);
        txn.setTxnType(ArTxnType.CHARGE);
        txn.setTxnDate(txnDate);
        txn.setAmountPaisa(amountPaisa);
        return txn;
    }

    private ArTransaction settlement(UUID accountId, LocalDate txnDate, long amountPaisa) {
        ArTransaction txn = new ArTransaction();
        txn.setCustomerAccountId(accountId);
        txn.setTxnType(ArTxnType.SETTLEMENT);
        txn.setTxnDate(txnDate);
        txn.setAmountPaisa(amountPaisa);
        return txn;
    }

    @Test
    void emptyList_producesFourZeroBuckets() {
        ArAgingReportDto report = calculator.age(List.of(), AS_OF);
        assertThat(report.totalArPaisa()).isZero();
        assertThat(report.buckets()).hasSize(4);
        assertThat(report.buckets()).allMatch(b -> b.amountPaisa() == 0);
    }

    @Test
    void bucketBoundaries_atExactly30_31_60_61_90_91Days() {
        UUID accountId = UUID.randomUUID();
        List<ArTransaction> txns = List.of(
                charge(accountId, AS_OF.minusDays(10), 1_000L),  // Current (<=30)
                charge(accountId, AS_OF.minusDays(30), 2_000L),  // Current (=30)
                charge(accountId, AS_OF.minusDays(31), 3_000L),  // 31-60 (=31)
                charge(accountId, AS_OF.minusDays(60), 4_000L),  // 31-60 (=60)
                charge(accountId, AS_OF.minusDays(61), 5_000L),  // 61-90 (=61)
                charge(accountId, AS_OF.minusDays(90), 6_000L),  // 61-90 (=90)
                charge(accountId, AS_OF.minusDays(91), 7_000L),  // Over 90 (=91)
                charge(accountId, AS_OF.minusDays(120), 8_000L)  // Over 90
        );

        ArAgingReportDto report = calculator.age(txns, AS_OF);

        assertThat(bucket(report, "Current").amountPaisa()).isEqualTo(3_000L);
        assertThat(bucket(report, "31-60 days").amountPaisa()).isEqualTo(7_000L);
        assertThat(bucket(report, "61-90 days").amountPaisa()).isEqualTo(11_000L);
        assertThat(bucket(report, "Over 90 days").amountPaisa()).isEqualTo(15_000L);
        assertThat(report.totalArPaisa()).isEqualTo(36_000L);
    }

    @Test
    void fullySettledCharge_contributesZero() {
        UUID accountId = UUID.randomUUID();
        List<ArTransaction> txns = List.of(
                charge(accountId, AS_OF.minusDays(10), 5_000L),
                settlement(accountId, AS_OF, 5_000L));

        ArAgingReportDto report = calculator.age(txns, AS_OF);
        assertThat(report.totalArPaisa()).isZero();
    }

    @Test
    void partiallySettledCharge_contributesOnlyRemainder() {
        UUID accountId = UUID.randomUUID();
        List<ArTransaction> txns = List.of(
                charge(accountId, AS_OF.minusDays(10), 10_000L),
                settlement(accountId, AS_OF, 4_000L));

        ArAgingReportDto report = calculator.age(txns, AS_OF);
        assertThat(report.totalArPaisa()).isEqualTo(6_000L);
        assertThat(bucket(report, "Current").amountPaisa()).isEqualTo(6_000L);
    }

    @Test
    void fifoAllocation_settlesOldestChargeFirst() {
        UUID accountId = UUID.randomUUID();
        List<ArTransaction> txns = List.of(
                charge(accountId, AS_OF.minusDays(50), 3_000L),  // oldest -> 31-60
                charge(accountId, AS_OF.minusDays(10), 4_000L),  // newest -> Current
                settlement(accountId, AS_OF, 3_000L));           // fully settles the OLDEST charge

        ArAgingReportDto report = calculator.age(txns, AS_OF);

        assertThat(bucket(report, "31-60 days").amountPaisa()).isZero();
        assertThat(bucket(report, "Current").amountPaisa()).isEqualTo(4_000L);
        assertThat(report.totalArPaisa()).isEqualTo(4_000L);
    }

    @Test
    void overpayment_neverProducesNegativeBucket() {
        UUID accountId = UUID.randomUUID();
        List<ArTransaction> txns = List.of(
                charge(accountId, AS_OF.minusDays(10), 5_000L),
                settlement(accountId, AS_OF, 8_000L)); // 3,000 surplus

        ArAgingReportDto report = calculator.age(txns, AS_OF);
        assertThat(report.totalArPaisa()).isZero();
        assertThat(report.buckets()).allMatch(b -> b.amountPaisa() >= 0);
    }

    private static io.restaurantos.finance.dto.ArAgingBucketDto bucket(ArAgingReportDto report, String label) {
        return report.buckets().stream().filter(b -> b.label().equals(label)).findFirst().orElseThrow();
    }
}
