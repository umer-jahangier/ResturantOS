package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.ExpenseStatus;
import io.restaurantos.finance.dto.CreateExpenseRequest;
import io.restaurantos.finance.dto.ExpenseDto;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.exception.ExpenseApprovalLimitExceededException;
import io.restaurantos.finance.feign.AuthorizationClient;
import io.restaurantos.finance.opa.OpaBackedAuthorizationClient;
import io.restaurantos.finance.opa.RealOpaTestConfig;
import io.restaurantos.finance.opa.TestPrincipal;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.ExpenseService;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 10-08: proves expense approval allow/deny is decided by a REAL OPA container running the REAL
 * {@code policies/} bundle — not a mock. This is the fix for standing lesson 10-06-A: see
 * {@link ExpenseApprovalIT}'s class javadoc, which does NOT exercise real OPA policy behaviour
 * (it {@code @MockitoBean}s {@code AuthorizationClient} and stubs a canned {@code allow}). Here,
 * {@code authorizationClient} is still declared with {@code @MockitoBean} (Spring Cloud
 * OpenFeign registers {@code @FeignClient} proxies as {@code primary} by default, so a plain
 * {@code @Primary @Bean AuthorizationClient} collides with it at context refresh — see
 * {@link RealOpaTestConfig}'s javadoc / 10-08-SUMMARY.md), but it is never stubbed with a canned
 * answer — it is wired in {@link #setUp()} to delegate every call to a real
 * {@link OpaBackedAuthorizationClient} talking to the {@link RealOpaTestConfig} Testcontainers
 * OPA instance, so every authorize() call in this class round-trips through the real
 * {@code finance.rego}.
 */
@Import(RealOpaTestConfig.class)
class ExpenseOpaPolicyIT extends FinanceTestBase {

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

    @Autowired
    private TestPrincipal testPrincipal;

    @MockitoBean
    private AuthorizationClient authorizationClient;

    private OpaBackedAuthorizationClient realOpaClient;

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

        // Delegate every call through to a real OPA-backed implementation instead of stubbing a
        // canned allow/deny — the whole point of this IT is that the real rego decides.
        realOpaClient = new OpaBackedAuthorizationClient(RealOpaTestConfig.opaBaseUrl(), testPrincipal);
        when(authorizationClient.authorize(any())).thenAnswer(inv -> realOpaClient.authorize(inv.getArgument(0)));

        setPrincipal(tenantId, branchId, List.of("finance.expense.approve"),
                Map.of("approval_limit_paisa", 1_000_000L));
    }

    private void setPrincipal(UUID tId, UUID bId, List<String> permissions, Map<String, Object> attributes) {
        testPrincipal.setUserId(UUID.randomUUID());
        testPrincipal.setTenantId(tId);
        testPrincipal.setBranchId(bId);
        testPrincipal.setPermissions(permissions);
        testPrincipal.setAttributes(attributes);
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
    void approve_allowedByRealPolicy_whenWithinLimit() {
        // Principal has finance.expense.approve and approval_limit_paisa (1,000,000) above the
        // expense amount (500,000). Sent action is "approve" (ExpenseService's
        // OPA_ACTION_APPROVE constant). MUST FAIL if that constant is reverted to the dotted
        // permission code "finance.expense.approve" — finance.rego's approve rule only matches
        // the short verb "approve", so a reverted action string hits `default allow := false`
        // and this assertion turns red. (Verified manually — see 10-08-SUMMARY.md negative
        // control.)
        ExpenseDto created = createExpense(500_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            ExpenseDto approved = expenseService.approve(created.id());
            assertThat(approved.status()).isEqualTo(ExpenseStatus.APPROVED);

            var jeOpt = journalEntryRepository.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, "EXPENSE", created.id());
            assertThat(jeOpt).isPresent();

            JournalEntryDto je = journalEntryService.getById(jeOpt.get().getId());
            assertThat(je.status().name()).isEqualTo("POSTED");
            assertThat(je.totalDebitPaisa()).isEqualTo(500_000L);
            assertThat(je.totalCreditPaisa()).isEqualTo(500_000L);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void approve_deniedByRealPolicy_whenOverLimit() {
        setPrincipal(tenantId, branchId, List.of("finance.expense.approve"),
                Map.of("approval_limit_paisa", 1L));

        ExpenseDto created = createExpense(500_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            assertThatThrownBy(() -> expenseService.approve(created.id()))
                    .isInstanceOf(ExpenseApprovalLimitExceededException.class);

            ExpenseDto reloaded = expenseService.getById(created.id());
            assertThat(reloaded.status()).isEqualTo(ExpenseStatus.PENDING_APPROVAL);

            // (tenantId, sourceType="EXPENSE", sourceId) is unique per expense — an empty
            // Optional here IS the JE-count assertion (zero JEs posted on the deny path).
            var jeOpt = journalEntryRepository.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, "EXPENSE", created.id());
            assertThat(jeOpt).isEmpty();
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void approve_deniedByRealPolicy_whenPermissionMissing() {
        setPrincipal(tenantId, branchId, List.of(),
                Map.of("approval_limit_paisa", 1_000_000L));

        ExpenseDto created = createExpense(500_000L);

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            assertThatThrownBy(() -> expenseService.approve(created.id()))
                    .isInstanceOf(ExpenseApprovalLimitExceededException.class);

            var jeOpt = journalEntryRepository.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, "EXPENSE", created.id());
            assertThat(jeOpt).isEmpty();
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void approve_deniedByRealPolicy_whenCrossBranch() {
        ExpenseDto created = createExpense(500_000L);

        // Resource (the expense) belongs to `branchId`; principal claims a different branch.
        setPrincipal(tenantId, UUID.randomUUID(), List.of("finance.expense.approve"),
                Map.of("approval_limit_paisa", 1_000_000L));

        tenantContext.set(tenantId, branchId, userId, null);
        try {
            assertThatThrownBy(() -> expenseService.approve(created.id()))
                    .isInstanceOf(ExpenseApprovalLimitExceededException.class);

            var jeOpt = journalEntryRepository.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, "EXPENSE", created.id());
            assertThat(jeOpt).isEmpty();
        } finally {
            tenantContext.clear();
        }
    }
}
