package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.CustomerAccountStatus;
import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.dto.ArTransactionDto;
import io.restaurantos.finance.dto.CreateArChargeRequest;
import io.restaurantos.finance.dto.CreateArSettlementRequest;
import io.restaurantos.finance.dto.CreateCustomerAccountRequest;
import io.restaurantos.finance.dto.CustomerAccountDto;
import io.restaurantos.finance.exception.CreditLimitExceededException;
import io.restaurantos.finance.exception.PeriodLockedException;
import io.restaurantos.finance.feign.InventoryInternalClient;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.repository.ArTransactionRepository;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.AccountingPeriodService;
import io.restaurantos.finance.service.ArService;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.PeriodCloseService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.finance.dto.AccountingPeriodDto;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * FIN-05 AR half (10-18): real-Postgres proof (Testcontainers, FinanceTestBase) that charges
 * and settlements post balanced JEs against the seeded 1200 Accounts Receivable, and that the
 * credit limit / RLS / period-lock invariants provably REJECT (10-06-A standing lesson: every
 * security/correctness claim needs a negative control watched going red).
 *
 * <p>Context-setup pattern copied from ExpenseApprovalIT (which passes 4/4), NOT from the
 * PRE-EXISTING out-of-scope "Branch context required" failures in JournalEntryImmutabilityIT /
 * JournalEntryBalanceTriggerIT / InternalAutoPostIT.
 */
class ArLedgerIT extends FinanceTestBase {

    private static final LocalDate TXN_DATE = LocalDate.of(2026, 6, 15);

    @Autowired
    private ArService arService;

    @Autowired
    private ProvisioningService provisioningService;

    @Autowired
    private PeriodCloseService periodCloseService;

    @Autowired
    private AccountingPeriodService periodService;

    @Autowired
    private JournalEntryService journalEntryService;

    @Autowired
    private JournalEntryRepository journalEntryRepository;

    @Autowired
    private ArTransactionRepository arTransactionRepository;

    @Autowired
    private TenantContext tenantContext;

    @MockitoBean
    private PosInternalClient posClient;

    @MockitoBean
    private InventoryInternalClient inventoryClient;

    @MockitoBean
    private PurchasingInternalClient purchasingClient;

    private UUID tenantId;
    private UUID branchId;
    private UUID userId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        userId = UUID.randomUUID();
        when(posClient.getOpenOrderCount(any(), any())).thenReturn(0L);
        when(inventoryClient.getPendingGrnCount(any())).thenReturn(0L);
        when(purchasingClient.getUnmatchedInvoiceCount(any())).thenReturn(0L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            provisioningService.provision(tenantId, 2026);
        } finally {
            tenantContext.clear();
        }
    }

    private CustomerAccountDto createAccount(long creditLimitPaisa) {
        tenantContext.set(tenantId, branchId, userId, null);
        try {
            return arService.createAccount(new CreateCustomerAccountRequest(
                    branchId, "HA-" + UUID.randomUUID().toString().substring(0, 8), "Acme Corp",
                    "Jane Doe", "0300-0000000", "jane@acme.test", creditLimitPaisa, 30, null));
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void charge_postsExactlyOneArTransactionAndOneBalancedJe() {
        CustomerAccountDto account = createAccount(1_000_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        ArTransactionDto txn;
        try {
            txn = arService.charge(new CreateArChargeRequest(
                    branchId, account.id(), TXN_DATE, 40_000L, null, "INV-1", null));
        } finally {
            tenantContext.clear();
        }

        assertThat(txn.amountPaisa()).isEqualTo(40_000L);
        assertThat(txn.journalEntryId()).isNotNull();

        var je = journalEntryService.getById(txn.journalEntryId());
        assertThat(je.status()).isEqualTo(JeStatus.POSTED);
        assertThat(je.totalDebitPaisa()).isEqualTo(40_000L);
        assertThat(je.totalCreditPaisa()).isEqualTo(40_000L);

        var arLine = je.lines().stream().filter(l -> "1200".equals(l.accountCode())).findFirst().orElseThrow();
        assertThat(arLine.debitPaisa()).isEqualTo(40_000L);
        assertThat(arLine.creditPaisa()).isEqualTo(0L);

        var revenueLine = je.lines().stream().filter(l -> "4100".equals(l.accountCode())).findFirst().orElseThrow();
        assertThat(revenueLine.creditPaisa()).isEqualTo(40_000L);
        assertThat(revenueLine.debitPaisa()).isEqualTo(0L);
    }

    @Test
    void settlement_postsDrBankCrArAndReducesBalance() {
        CustomerAccountDto account = createAccount(1_000_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            arService.charge(new CreateArChargeRequest(branchId, account.id(), TXN_DATE, 50_000L, null, null, null));
            var settled = arService.settle(new CreateArSettlementRequest(
                    branchId, account.id(), TXN_DATE.plusDays(5), 50_000L, "PMT-1", null));

            var je = journalEntryService.getById(settled.journalEntryId());
            var bankLine = je.lines().stream().filter(l -> "1110".equals(l.accountCode())).findFirst().orElseThrow();
            assertThat(bankLine.debitPaisa()).isEqualTo(50_000L);
            var arLine = je.lines().stream().filter(l -> "1200".equals(l.accountCode())).findFirst().orElseThrow();
            assertThat(arLine.creditPaisa()).isEqualTo(50_000L);

            var statement = arService.getStatement(account.id());
            assertThat(statement.balancePaisa()).isEqualTo(0L);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void balanceMath_threeChargesOnePartialSettlement_exactExpectedBalance() {
        CustomerAccountDto account = createAccount(1_000_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            arService.charge(new CreateArChargeRequest(branchId, account.id(), TXN_DATE, 10_000L, null, null, null));
            arService.charge(new CreateArChargeRequest(branchId, account.id(), TXN_DATE, 20_000L, null, null, null));
            arService.charge(new CreateArChargeRequest(branchId, account.id(), TXN_DATE, 30_000L, null, null, null));
            arService.settle(new CreateArSettlementRequest(branchId, account.id(), TXN_DATE, 15_000L, null, null));

            var statement = arService.getStatement(account.id());
            assertThat(statement.balancePaisa()).isEqualTo(45_000L); // 60,000 - 15,000
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void aging_bucketsChargesByAgeAndTotalsMatch() {
        CustomerAccountDto account = createAccount(1_000_000L);
        // Kept inside the provisioned FY2026 period range (Jul 2025 - Jun 2026, 06-02-A) so that
        // asOf.minusDays(120) still lands on an OPEN period for autoPostInternal.
        LocalDate asOf = LocalDate.of(2026, 6, 13);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            arService.charge(new CreateArChargeRequest(branchId, account.id(), asOf.minusDays(10), 1_000L, null, null, null));
            arService.charge(new CreateArChargeRequest(branchId, account.id(), asOf.minusDays(45), 2_000L, null, null, null));
            arService.charge(new CreateArChargeRequest(branchId, account.id(), asOf.minusDays(75), 3_000L, null, null, null));
            arService.charge(new CreateArChargeRequest(branchId, account.id(), asOf.minusDays(120), 4_000L, null, null, null));

            var report = arService.getAging(branchId, asOf);
            assertThat(report.totalArPaisa()).isEqualTo(10_000L);
            assertThat(bucket(report, "Current").amountPaisa()).isEqualTo(1_000L);
            assertThat(bucket(report, "31-60 days").amountPaisa()).isEqualTo(2_000L);
            assertThat(bucket(report, "61-90 days").amountPaisa()).isEqualTo(3_000L);
            assertThat(bucket(report, "Over 90 days").amountPaisa()).isEqualTo(4_000L);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void negativeControl_creditLimitExceeded_rejectsAndPersistsNoRowNoJe() {
        CustomerAccountDto account = createAccount(100_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            arService.charge(new CreateArChargeRequest(branchId, account.id(), TXN_DATE, 80_000L, null, null, null));
            long arTxnCountBefore = arTransactionRepository.count();
            long jeCountBefore = journalEntryRepository.count();

            assertThatThrownBy(() -> arService.charge(new CreateArChargeRequest(
                    branchId, account.id(), TXN_DATE, 30_000L, null, null, null)))
                    .isInstanceOf(CreditLimitExceededException.class);

            assertThat(arTransactionRepository.count()).isEqualTo(arTxnCountBefore);
            assertThat(journalEntryRepository.count()).isEqualTo(jeCountBefore);
            assertThat(arService.getStatement(account.id()).balancePaisa()).isEqualTo(80_000L);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void negativeControl_tenantB_cannotSeeTenantAsAccountsOrTransactions() {
        CustomerAccountDto account = createAccount(1_000_000L);
        tenantContext.set(tenantId, branchId, userId, null);
        try {
            arService.charge(new CreateArChargeRequest(branchId, account.id(), TXN_DATE, 10_000L, null, null, null));
        } finally {
            tenantContext.clear();
        }

        UUID tenantB = UUID.randomUUID();
        UUID branchB = UUID.randomUUID();
        UUID userB = UUID.randomUUID();
        tenantContext.set(tenantB, branchB, userB, null);
        try {
            provisioningService.provision(tenantB, 2026);
        } finally {
            tenantContext.clear();
        }

        tenantContext.set(tenantB, branchB, userB, null);
        try {
            var pageForTenantB = arService.listAccounts(PageRequest.of(0, 50));
            assertThat(pageForTenantB.getContent()).noneMatch(a -> a.id().equals(account.id()));

            assertThatThrownBy(() -> arService.getStatement(account.id()))
                    .isInstanceOf(io.restaurantos.finance.exception.CustomerAccountNotFoundException.class);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void negativeControl_lockedPeriod_returns423AndNoArTransactionSurvives() {
        CustomerAccountDto account = createAccount(1_000_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        AccountingPeriodDto junePeriod;
        try {
            junePeriod = periodService.listByFiscalYear(2026).stream()
                    .filter(p -> p.periodNo() == 12) // June 2026 in Pakistan FY (06-02-A)
                    .findFirst().orElseThrow();
            periodCloseService.close(junePeriod.id(), true);
        } finally {
            tenantContext.clear();
        }

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            long countBefore = arTransactionRepository.count();
            assertThatThrownBy(() -> arService.charge(new CreateArChargeRequest(
                    branchId, account.id(), LocalDate.of(2026, 6, 20), 10_000L, null, null, null)))
                    .isInstanceOf(PeriodLockedException.class);
            assertThat(arTransactionRepository.count()).isEqualTo(countBefore);
        } finally {
            tenantContext.clear();
        }
    }

    private static io.restaurantos.finance.dto.ArAgingBucketDto bucket(
            io.restaurantos.finance.dto.ArAgingReportDto report, String label) {
        return report.buckets().stream().filter(b -> b.label().equals(label)).findFirst().orElseThrow();
    }
}
