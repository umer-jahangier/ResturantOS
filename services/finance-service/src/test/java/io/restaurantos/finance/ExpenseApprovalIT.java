package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.ExpenseStatus;
import io.restaurantos.finance.dto.CreateExpenseRequest;
import io.restaurantos.finance.dto.ExpenseDto;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.exception.ExpenseApprovalLimitExceededException;
import io.restaurantos.finance.feign.AuthorizationClient;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.ExpenseService;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * FIN-05: proves expense approvals respect OPA approval limits.
 * {@link FinanceTestBase} does not provide an AuthorizationClient mock (it predates one — see
 * 10-05-PLAN.md critical_codebase_facts #8), so it is declared here.
 */
class ExpenseApprovalIT extends FinanceTestBase {

    private static final String EXPENSE_ACCOUNT_CODE = "6800"; // Miscellaneous Expense
    private static final LocalDate EXPENSE_DATE = LocalDate.of(2026, 6, 15);

    @Autowired
    private ExpenseService expenseService;

    @Autowired
    private ProvisioningService provisioningService;

    @Autowired
    private JournalEntryRepository journalEntryRepository;

    @Autowired
    private JournalEntryService journalEntryService;

    @Autowired
    private TenantContext tenantContext;

    @MockitoBean
    private AuthorizationClient authorizationClient;

    private UUID tenantId;
    private UUID branchId;
    private UUID userId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        userId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, userId, null);
        try {
            provisioningService.provision(tenantId, 2026);
        } finally {
            tenantContext.clear();
        }
    }

    private ExpenseDto createExpense(long amountPaisa) {
        tenantContext.set(tenantId, branchId, userId, null);
        try {
            return expenseService.create(new CreateExpenseRequest(
                    branchId, EXPENSE_DATE, EXPENSE_ACCOUNT_CODE, "Office supplies", amountPaisa));
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void approve_withinLimit_postsJeAndApproves() {
        when(authorizationClient.authorize(any()))
                .thenReturn(ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));

        ExpenseDto created = createExpense(10_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            ExpenseDto approved = expenseService.approve(created.id());
            assertThat(approved.status()).isEqualTo(ExpenseStatus.APPROVED);

            var jeOpt = journalEntryRepository.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, "EXPENSE", created.id());
            assertThat(jeOpt).isPresent();

            JournalEntryDto je = journalEntryService.getById(jeOpt.get().getId());
            assertThat(je.status().name()).isEqualTo("POSTED");
            assertThat(je.totalDebitPaisa()).isEqualTo(10_000L);
            assertThat(je.totalCreditPaisa()).isEqualTo(10_000L);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void approve_overLimit_denied() {
        when(authorizationClient.authorize(any()))
                .thenReturn(ApiResponse.ok(new AuthorizationClient.AuthorizeResult(false, "over approval limit")));

        ExpenseDto created = createExpense(500_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            assertThatThrownBy(() -> expenseService.approve(created.id()))
                    .isInstanceOf(ExpenseApprovalLimitExceededException.class);

            ExpenseDto reloaded = expenseService.getById(created.id());
            assertThat(reloaded.status()).isEqualTo(ExpenseStatus.PENDING_APPROVAL);

            var jeOpt = journalEntryRepository.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, "EXPENSE", created.id());
            assertThat(jeOpt).isEmpty();
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void approve_twice_isIdempotent() {
        when(authorizationClient.authorize(any()))
                .thenReturn(ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));

        ExpenseDto created = createExpense(20_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            expenseService.approve(created.id());
            try {
                // Re-approving after status flips to APPROVED may throw on the status guard;
                // the assertion below is what actually proves idempotency (fact #4).
                expenseService.approve(created.id());
            } catch (IllegalStateException statusGuardRejection) {
                // expected once the expense is no longer PENDING_APPROVAL
            }

            var jeOpt = journalEntryRepository.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, "EXPENSE", created.id());
            assertThat(jeOpt).isPresent(); // exactly one JE — findBy...Optional would throw on duplicates
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void list_isBranchAndTenantIsolated_andStatusFilterNarrows() {
        // branch A, this tenant
        ExpenseDto branchAExpense1 = createExpense(1_000L);
        ExpenseDto branchAExpense2 = createExpense(2_000L);

        // reject one so we can prove the status filter narrows
        tenantContext.set(tenantId, branchId, userId, null);
        ExpenseDto rejected;
        try {
            rejected = expenseService.reject(branchAExpense2.id(), "not budgeted");
        } finally {
            tenantContext.clear();
        }

        // branch B, same tenant -> must not appear in branch A's list
        UUID branchB = UUID.randomUUID();
        tenantContext.set(tenantId, branchB, userId, null);
        try {
            expenseService.create(new CreateExpenseRequest(
                    branchB, EXPENSE_DATE, EXPENSE_ACCOUNT_CODE, "Other branch expense", 3_000L));
        } finally {
            tenantContext.clear();
        }

        // another tenant entirely, same branch id coincidentally reused -> must never leak
        UUID otherTenantId = UUID.randomUUID();
        tenantContext.set(otherTenantId, branchId, UUID.randomUUID(), null);
        try {
            provisioningService.provision(otherTenantId, 2026);
            expenseService.create(new CreateExpenseRequest(
                    branchId, EXPENSE_DATE, EXPENSE_ACCOUNT_CODE, "Other tenant expense", 4_000L));
        } finally {
            tenantContext.clear();
        }

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            var all = expenseService.list(branchId, null);
            assertThat(all).extracting(ExpenseDto::id)
                    .containsExactlyInAnyOrder(branchAExpense1.id(), branchAExpense2.id());

            var pendingOnly = expenseService.list(branchId, List.of(ExpenseStatus.PENDING_APPROVAL));
            assertThat(pendingOnly).extracting(ExpenseDto::id).containsExactly(branchAExpense1.id());

            var rejectedOnly = expenseService.list(branchId, List.of(ExpenseStatus.REJECTED));
            assertThat(rejectedOnly).extracting(ExpenseDto::id).containsExactly(rejected.id());
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void reject_requiresReason() {
        ExpenseDto created = createExpense(15_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            assertThatThrownBy(() -> expenseService.reject(created.id(), null))
                    .isInstanceOf(IllegalStateException.class);
            assertThatThrownBy(() -> expenseService.reject(created.id(), "   "))
                    .isInstanceOf(IllegalStateException.class);

            ExpenseDto rejected = expenseService.reject(created.id(), "not budgeted");
            assertThat(rejected.status()).isEqualTo(ExpenseStatus.REJECTED);
            assertThat(rejected.rejectReason()).isEqualTo("not budgeted");

            var jeOpt = journalEntryRepository.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, "EXPENSE", created.id());
            assertThat(jeOpt).isEmpty();
        } finally {
            tenantContext.clear();
        }
    }
}
