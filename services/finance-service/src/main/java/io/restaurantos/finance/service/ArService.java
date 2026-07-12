package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.ArTxnType;
import io.restaurantos.finance.domain.enums.CustomerAccountStatus;
import io.restaurantos.finance.domain.model.ArTransaction;
import io.restaurantos.finance.domain.model.CustomerAccount;
import io.restaurantos.finance.dto.ArAgingReportDto;
import io.restaurantos.finance.dto.ArTransactionDto;
import io.restaurantos.finance.dto.CreateArChargeRequest;
import io.restaurantos.finance.dto.CreateArSettlementRequest;
import io.restaurantos.finance.dto.CreateCustomerAccountRequest;
import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.CustomerAccountDto;
import io.restaurantos.finance.dto.CustomerAccountStatementDto;
import io.restaurantos.finance.dto.InternalArChargeRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.exception.ArSettlementExceedsBalanceException;
import io.restaurantos.finance.exception.CreditLimitExceededException;
import io.restaurantos.finance.exception.CustomerAccountNotFoundException;
import io.restaurantos.finance.exception.CustomerAccountSuspendedException;
import io.restaurantos.finance.exception.InvalidAccountCodeException;
import io.restaurantos.finance.repository.ArTransactionRepository;
import io.restaurantos.finance.repository.ChartOfAccountRepository;
import io.restaurantos.finance.repository.CustomerAccountRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * FIN-05 AR half (10-18, decision 10-17-A). AR is sourced from corporate/house accounts.
 * charge() (manual) and chargeFromOrder() (Phase 7's POS seam) funnel into ONE private
 * postCharge(...) so the two writers cannot drift apart. AR is NOT OPA-gated (10-18-B) — a
 * credit limit is a domain invariant on the account, not an approval workflow.
 */
@Service
public class ArService {

    static final String AR_ACCOUNT_CODE = "1200";
    static final String BANK_ACCOUNT_CODE = "1110";
    static final String DEFAULT_REVENUE_ACCOUNT_CODE = "4100";
    private static final String SOURCE_TYPE_MANUAL = "MANUAL";
    private static final String SOURCE_TYPE_POS_ORDER = "POS_ORDER";
    private static final String JE_SOURCE_CHARGE = "AR_CHARGE";
    private static final String JE_SOURCE_SETTLEMENT = "AR_SETTLEMENT";

    private final CustomerAccountRepository accountRepository;
    private final ArTransactionRepository txnRepository;
    private final ChartOfAccountRepository coaRepository;
    private final JournalEntryService journalEntryService;
    private final ArAgingCalculator agingCalculator;
    private final TenantContext tenantContext;

    public ArService(CustomerAccountRepository accountRepository,
                      ArTransactionRepository txnRepository,
                      ChartOfAccountRepository coaRepository,
                      JournalEntryService journalEntryService,
                      ArAgingCalculator agingCalculator,
                      TenantContext tenantContext) {
        this.accountRepository = accountRepository;
        this.txnRepository = txnRepository;
        this.coaRepository = coaRepository;
        this.journalEntryService = journalEntryService;
        this.agingCalculator = agingCalculator;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public CustomerAccountDto createAccount(CreateCustomerAccountRequest req) {
        UUID tenantId = tenantContext.requireTenantId();
        if (accountRepository.existsByTenantIdAndAccountCode(tenantId, req.accountCode())) {
            throw new IllegalStateException("Account code already exists: " + req.accountCode());
        }

        CustomerAccount account = new CustomerAccount();
        // NEVER call setId() on a new entity — Spring Data calls merge() on a non-null ID (03-02-B).
        account.setTenantId(tenantId);
        account.setBranchId(req.branchId());
        account.setAccountCode(req.accountCode());
        account.setName(req.name());
        account.setContactName(req.contactName());
        account.setContactPhone(req.contactPhone());
        account.setContactEmail(req.contactEmail());
        account.setCreditLimitPaisa(req.creditLimitPaisa());
        account.setPaymentTermsDays(req.paymentTermsDays());
        account.setStatus(CustomerAccountStatus.ACTIVE);
        account.setCrmCustomerId(req.crmCustomerId());

        return toAccountDto(accountRepository.save(account));
    }

    @Transactional(readOnly = true)
    public Page<CustomerAccountDto> listAccounts(Pageable pageable) {
        UUID tenantId = tenantContext.requireTenantId();
        return accountRepository.findByTenantIdAndDeletedAtIsNull(tenantId, pageable)
                .map(this::toAccountDto);
    }

    @Transactional
    public ArTransactionDto charge(CreateArChargeRequest req) {
        return postCharge(req.branchId(), req.customerAccountId(), req.txnDate(), req.amountPaisa(),
                req.revenueAccountCode(), req.reference(), req.memo(), SOURCE_TYPE_MANUAL, null);
    }

    /** Phase 7's POS "charge to account" tender calls this via POST /internal/finance/ar/charges. */
    @Transactional
    public ArTransactionDto chargeFromOrder(InternalArChargeRequest req) {
        return postCharge(req.branchId(), req.customerAccountId(), req.chargeDate(), req.amountPaisa(),
                req.revenueAccountCode(), req.reference(), null, SOURCE_TYPE_POS_ORDER, req.orderId());
    }

    private ArTransactionDto postCharge(UUID branchId, UUID customerAccountId, LocalDate txnDate,
                                         long amountPaisa, String revenueAccountCodeOverride,
                                         String reference, String memo, String sourceType, UUID sourceId) {
        UUID tenantId = tenantContext.requireTenantId();

        // Idempotency (the POS retry contract): a prior charge for this source is returned unchanged.
        if (sourceId != null) {
            var existing = txnRepository.findByTenantIdAndSourceTypeAndSourceId(tenantId, sourceType, sourceId);
            if (existing.isPresent()) {
                return toTxnDto(existing.get());
            }
        }

        CustomerAccount account = accountRepository.findByTenantIdAndId(tenantId, customerAccountId)
                .orElseThrow(() -> new CustomerAccountNotFoundException(customerAccountId));
        if (account.getStatus() == CustomerAccountStatus.SUSPENDED) {
            throw new CustomerAccountSuspendedException(customerAccountId);
        }

        String revenueAccountCode = (revenueAccountCodeOverride == null || revenueAccountCodeOverride.isBlank())
                ? DEFAULT_REVENUE_ACCOUNT_CODE
                : revenueAccountCodeOverride;
        validateAccountCode(tenantId, revenueAccountCode);

        long currentBalance = txnRepository.balanceForAccount(tenantId, customerAccountId);
        if (currentBalance + amountPaisa > account.getCreditLimitPaisa()) {
            throw new CreditLimitExceededException(customerAccountId, currentBalance,
                    account.getCreditLimitPaisa(), amountPaisa);
        }

        String jeMemo = "AR charge " + account.getAccountCode();
        var jePost = journalEntryService.autoPostInternal(new InternalAutoPostJeRequest(
                branchId,
                txnDate,
                jeMemo,
                JE_SOURCE_CHARGE,
                sourceId != null ? sourceId : UUID.randomUUID(),
                List.of(
                        new CreateJeLineRequest(AR_ACCOUNT_CODE, jeMemo, amountPaisa, 0L),
                        new CreateJeLineRequest(revenueAccountCode, jeMemo, 0L, amountPaisa))));

        ArTransaction txn = new ArTransaction();
        txn.setTenantId(tenantId);
        txn.setBranchId(branchId);
        txn.setCustomerAccountId(customerAccountId);
        txn.setTxnType(ArTxnType.CHARGE);
        txn.setTxnDate(txnDate);
        txn.setDueDate(txnDate.plusDays(account.getPaymentTermsDays()));
        txn.setAmountPaisa(amountPaisa);
        txn.setSourceType(sourceType);
        txn.setSourceId(sourceId);
        txn.setJournalEntryId(jePost.jeId());
        txn.setReference(reference);
        txn.setMemo(memo);

        ArTransaction saved = txnRepository.save(txn);
        return toTxnDto(saved);
    }

    @Transactional
    public ArTransactionDto settle(CreateArSettlementRequest req) {
        UUID tenantId = tenantContext.requireTenantId();
        CustomerAccount account = accountRepository.findByTenantIdAndId(tenantId, req.customerAccountId())
                .orElseThrow(() -> new CustomerAccountNotFoundException(req.customerAccountId()));

        long currentBalance = txnRepository.balanceForAccount(tenantId, req.customerAccountId());
        if (req.amountPaisa() > currentBalance) {
            throw new ArSettlementExceedsBalanceException(req.amountPaisa(), currentBalance);
        }

        String jeMemo = "AR settlement " + account.getAccountCode();
        var jePost = journalEntryService.autoPostInternal(new InternalAutoPostJeRequest(
                req.branchId(),
                req.txnDate(),
                jeMemo,
                JE_SOURCE_SETTLEMENT,
                UUID.randomUUID(),
                List.of(
                        new CreateJeLineRequest(BANK_ACCOUNT_CODE, jeMemo, req.amountPaisa(), 0L),
                        new CreateJeLineRequest(AR_ACCOUNT_CODE, jeMemo, 0L, req.amountPaisa()))));

        ArTransaction txn = new ArTransaction();
        txn.setTenantId(tenantId);
        txn.setBranchId(req.branchId());
        txn.setCustomerAccountId(req.customerAccountId());
        txn.setTxnType(ArTxnType.SETTLEMENT);
        txn.setTxnDate(req.txnDate());
        txn.setDueDate(null);
        txn.setAmountPaisa(req.amountPaisa());
        txn.setSourceType(SOURCE_TYPE_MANUAL);
        txn.setSourceId(null);
        txn.setJournalEntryId(jePost.jeId());
        txn.setReference(req.reference());
        txn.setMemo(req.memo());

        return toTxnDto(txnRepository.save(txn));
    }

    @Transactional(readOnly = true)
    public CustomerAccountStatementDto getStatement(UUID customerAccountId) {
        UUID tenantId = tenantContext.requireTenantId();
        CustomerAccount account = accountRepository.findByTenantIdAndId(tenantId, customerAccountId)
                .orElseThrow(() -> new CustomerAccountNotFoundException(customerAccountId));
        long balance = txnRepository.balanceForAccount(tenantId, customerAccountId);
        List<ArTransactionDto> txns = txnRepository.findByCustomerAccountIdOrderByTxnDateAsc(customerAccountId)
                .stream().map(this::toTxnDto).toList();
        return new CustomerAccountStatementDto(toAccountDto(account), balance, txns);
    }

    @Transactional(readOnly = true)
    public ArAgingReportDto getAging(UUID branchId, LocalDate asOf) {
        UUID tenantId = tenantContext.requireTenantId();
        List<ArTransaction> txns = txnRepository.findByTenantIdAndBranchId(tenantId, branchId);
        return agingCalculator.age(txns, asOf);
    }

    private void validateAccountCode(UUID tenantId, String accountCode) {
        var account = coaRepository.findByTenantIdAndCode(tenantId, accountCode)
                .orElseThrow(() -> new InvalidAccountCodeException(accountCode));
        if (!account.isActive()) {
            throw new InvalidAccountCodeException(accountCode);
        }
    }

    private CustomerAccountDto toAccountDto(CustomerAccount account) {
        long balance = txnRepository.balanceForAccount(account.getTenantId(), account.getId());
        return new CustomerAccountDto(
                account.getId(),
                account.getBranchId(),
                account.getAccountCode(),
                account.getName(),
                account.getContactName(),
                account.getContactPhone(),
                account.getContactEmail(),
                account.getCreditLimitPaisa(),
                account.getPaymentTermsDays(),
                account.getStatus(),
                account.getCrmCustomerId(),
                balance);
    }

    private ArTransactionDto toTxnDto(ArTransaction txn) {
        long balanceAfter = txnRepository.balanceForAccount(txn.getTenantId(), txn.getCustomerAccountId());
        return new ArTransactionDto(
                txn.getId(),
                txn.getCustomerAccountId(),
                txn.getTxnType(),
                txn.getTxnDate(),
                txn.getDueDate(),
                txn.getAmountPaisa(),
                txn.getSourceType(),
                txn.getSourceId(),
                txn.getJournalEntryId(),
                txn.getReference(),
                txn.getMemo(),
                balanceAfter);
    }
}
