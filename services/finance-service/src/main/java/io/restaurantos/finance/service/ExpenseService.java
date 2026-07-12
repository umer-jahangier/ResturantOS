package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.ExpenseStatus;
import io.restaurantos.finance.domain.model.Expense;
import io.restaurantos.finance.dto.CreateExpenseRequest;
import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.ExpenseDto;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.exception.ExpenseApprovalLimitExceededException;
import io.restaurantos.finance.exception.InvalidAccountCodeException;
import io.restaurantos.finance.feign.AuthorizationClient;
import io.restaurantos.finance.repository.ChartOfAccountRepository;
import io.restaurantos.finance.repository.ExpenseRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * FIN-05: expense create/approve/reject. Approval is gated by BOTH RBAC
 * (finance.expense.approve authority — see ExpenseController) AND an OPA
 * approval-limit check via AuthorizationClient (fact #2 — shared-lib's OpaClient
 * bean is conditional on restaurantos.opa.url, which finance-service does not set).
 * On OPA allow, a balanced JE is auto-posted via JournalEntryService.autoPostInternal,
 * which is already idempotent on (sourceType, sourceId) — see fact #4.
 */
@Service
public class ExpenseService {

    private static final String BANK_ACCOUNT_CODE = "1110";
    private static final String SOURCE_TYPE = "EXPENSE";

    // Canonical OPA action vocabulary (decision 10-07-A): the rego short verb, distinct from the
    // dotted permission code ("finance.expense.approve") checked inside the policy via common.has_permission.
    // -> policies/restaurantos/finance.rego: allow if input.action == "approve"
    private static final String OPA_ACTION_APPROVE = "approve";

    private final ExpenseRepository expenseRepository;
    private final ChartOfAccountRepository coaRepository;
    private final AuthorizationClient authorizationClient;
    private final JournalEntryService journalEntryService;
    private final TenantContext tenantContext;

    public ExpenseService(ExpenseRepository expenseRepository,
                           ChartOfAccountRepository coaRepository,
                           AuthorizationClient authorizationClient,
                           JournalEntryService journalEntryService,
                           TenantContext tenantContext) {
        this.expenseRepository = expenseRepository;
        this.coaRepository = coaRepository;
        this.authorizationClient = authorizationClient;
        this.journalEntryService = journalEntryService;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public ExpenseDto create(CreateExpenseRequest req) {
        UUID tenantId = tenantContext.requireTenantId();
        validateAccountCode(tenantId, req.expenseAccountCode());

        Expense expense = new Expense();
        // NEVER set expense.setId() — Spring Data calls merge() on non-null ID [03-02-B]
        expense.setTenantId(tenantId);
        expense.setBranchId(req.branchId());
        expense.setExpenseDate(req.expenseDate());
        expense.setExpenseAccountCode(req.expenseAccountCode());
        expense.setDescription(req.description());
        expense.setAmountPaisa(req.amountPaisa());
        expense.setStatus(ExpenseStatus.PENDING_APPROVAL);
        expense.setRequestedBy(tenantContext.getUserId().orElse(null));

        return toDto(expenseRepository.save(expense));
    }

    @Transactional
    public ExpenseDto approve(UUID id) {
        Expense expense = findById(id);
        if (expense.getStatus() != ExpenseStatus.PENDING_APPROVAL) {
            throw new IllegalStateException("Expense is not pending approval");
        }

        assertOpaAllows(expense);

        UUID approverId = tenantContext.getUserId().orElse(null);
        expense.setStatus(ExpenseStatus.APPROVED);
        expense.setApprovedBy(approverId);
        expense.setApprovedAt(Instant.now());
        expenseRepository.save(expense);

        journalEntryService.autoPostInternal(new InternalAutoPostJeRequest(
                expense.getBranchId(),
                expense.getExpenseDate(),
                "Expense " + expense.getId(),
                SOURCE_TYPE,
                expense.getId(),
                List.of(
                        new CreateJeLineRequest(expense.getExpenseAccountCode(), expense.getDescription(),
                                expense.getAmountPaisa(), 0L),
                        new CreateJeLineRequest(BANK_ACCOUNT_CODE, expense.getDescription(),
                                0L, expense.getAmountPaisa()))));

        return toDto(expense);
    }

    @Transactional
    public ExpenseDto reject(UUID id, String reason) {
        if (reason == null || reason.isBlank()) {
            throw new IllegalStateException("Rejection reason is required");
        }
        Expense expense = findById(id);
        if (expense.getStatus() != ExpenseStatus.PENDING_APPROVAL) {
            throw new IllegalStateException("Expense is not pending approval");
        }

        expense.setStatus(ExpenseStatus.REJECTED);
        expense.setRejectReason(reason);
        expenseRepository.save(expense);

        return toDto(expense);
    }

    @Transactional(readOnly = true)
    public ExpenseDto getById(UUID id) {
        return toDto(findById(id));
    }

    private Expense findById(UUID id) {
        return expenseRepository.findById(id)
                .orElseThrow(() -> new IllegalStateException("Expense not found: " + id));
    }

    private void validateAccountCode(UUID tenantId, String accountCode) {
        var account = coaRepository.findByTenantIdAndCode(tenantId, accountCode)
                .orElseThrow(() -> new InvalidAccountCodeException(accountCode));
        if (!account.isActive()) {
            throw new InvalidAccountCodeException(accountCode);
        }
    }

    private void assertOpaAllows(Expense expense) {
        ApiResponse<AuthorizationClient.AuthorizeResult> response = authorizationClient.authorize(
                new AuthorizationClient.AuthorizePayload(
                        "finance",
                        OPA_ACTION_APPROVE,
                        new AuthorizationClient.Resource(
                                "expense", expense.getId(), expense.getTenantId(), expense.getBranchId(),
                                expense.getRequestedBy(), expense.getStatus().name(), expense.getAmountPaisa())));
        if (response.data() == null || !response.data().allow()) {
            throw new ExpenseApprovalLimitExceededException();
        }
    }

    private ExpenseDto toDto(Expense expense) {
        return new ExpenseDto(
                expense.getId(),
                expense.getBranchId(),
                expense.getExpenseDate(),
                expense.getExpenseAccountCode(),
                expense.getDescription(),
                expense.getAmountPaisa(),
                expense.getStatus(),
                expense.getRequestedBy(),
                expense.getApprovedBy(),
                expense.getApprovedAt(),
                expense.getRejectReason());
    }
}
