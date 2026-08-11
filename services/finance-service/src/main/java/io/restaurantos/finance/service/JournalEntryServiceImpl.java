package io.restaurantos.finance.service;

import io.restaurantos.finance.authz.FinanceAuthorizationService;
import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.domain.model.AccountingPeriod;
import io.restaurantos.finance.domain.model.JeSequence;
import io.restaurantos.finance.domain.model.JournalEntry;
import io.restaurantos.finance.domain.model.JournalLine;
import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.exception.InvalidAccountCodeException;
import io.restaurantos.finance.exception.JeAlreadyPostedException;
import io.restaurantos.finance.exception.JeNotFoundException;
import io.restaurantos.finance.exception.PeriodLockedException;
import io.restaurantos.finance.mapper.JournalEntryMapper;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.finance.repository.ChartOfAccountRepository;
import io.restaurantos.finance.repository.JeSequenceRepository;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Class-level @Transactional ensures ALL methods run in transactions.
 * CRITICAL for the deferred balance trigger: it fires at the PostgreSQL COMMIT,
 * which maps to the Spring transaction commit. post() MUST be transactional.
 */
@Service
@Transactional
public class JournalEntryServiceImpl implements JournalEntryService {

    private static final String FINANCE_EXCHANGE = "finance.topic";
    private static final String JOURNAL_POSTED_KEY = "finance.journal.posted";
    private static final String JOURNAL_POSTED_TYPE = "JOURNAL_POSTED";

    private final JournalEntryRepository jeRepo;
    private final AccountingPeriodRepository periodRepo;
    private final ChartOfAccountRepository coaRepo;
    private final JeSequenceRepository jeSeqRepo;
    private final JournalEntryMapper mapper;
    private final TenantContext tenantContext;
    private final EventPublisher eventPublisher;
    private final EntityManager entityManager;
    private final FinanceAuthorizationService authorization;

    public JournalEntryServiceImpl(JournalEntryRepository jeRepo,
                                    AccountingPeriodRepository periodRepo,
                                    ChartOfAccountRepository coaRepo,
                                    JeSequenceRepository jeSeqRepo,
                                    JournalEntryMapper mapper,
                                    TenantContext tenantContext,
                                    EventPublisher eventPublisher,
                                    EntityManager entityManager,
                                    FinanceAuthorizationService authorization) {
        this.jeRepo = jeRepo;
        this.periodRepo = periodRepo;
        this.coaRepo = coaRepo;
        this.jeSeqRepo = jeSeqRepo;
        this.mapper = mapper;
        this.tenantContext = tenantContext;
        this.eventPublisher = eventPublisher;
        this.entityManager = entityManager;
        this.authorization = authorization;
    }

    private void ensureTenantGuc() {
        TenantGucHelper.apply(entityManager, tenantContext);
    }

    private UUID requireBranchId(UUID requestedBranchId) {
        UUID contextBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new IllegalStateException("Branch context required"));
        if (requestedBranchId != null && !requestedBranchId.equals(contextBranchId)) {
            throw new IllegalStateException("Branch mismatch with active session");
        }
        return contextBranchId;
    }

    private void validateAccountCodes(UUID tenantId, CreateJeRequest req) {
        for (var lineReq : req.lines()) {
            var account = coaRepo.findByTenantIdAndCode(tenantId, lineReq.accountCode())
                    .orElseThrow(() -> new InvalidAccountCodeException(lineReq.accountCode()));
            if (!account.isActive()) {
                throw new InvalidAccountCodeException(lineReq.accountCode());
            }
        }
    }

    /**
     * User-facing JE creation: the {@code post_journal} gate, then the mechanics.
     *
     * <p>The gate lives HERE and not in {@link #createInternal} because {@link #autoPostInternal}
     * — the seam POS, HR, inventory and purchasing post through — has no user principal to
     * authorize. It arrives on {@code /internal/**} behind the shared-service secret, carrying a
     * system identity, and asking OPA whether "the caller" holds {@code finance.journal.post} would
     * deny every automatic posting in the platform. Gating {@code create} directly did exactly that
     * and took 27 auto-posting tests down with it.
     */
    @Override
    public JournalEntryDto create(CreateJeRequest req) {
        return create(req, true);
    }

    /** Mechanics only — NO authorization. Reachable from {@link #autoPostInternal}. */
    private JournalEntryDto createInternal(CreateJeRequest req) {
        return create(req, false);
    }

    /**
     * @param enforcePolicy false ONLY on the internal auto-posting seam.
     *
     * <p>The gate sits where it does — after the period and account-code checks, next to the branch
     * it needs — rather than at the top of the public method. Hoisting it changed the order in which
     * this method fails: a post to a LOCKED period with no branch context started reporting "Branch
     * context required" instead of 423 PERIOD_LOCKED, because the gate resolved the branch before
     * the period check ran. Neither answer is a security decision, and the caller has already
     * cleared {@code @PreAuthorize}, so the honest one is the one that names the real problem.
     */
    private JournalEntryDto create(CreateJeRequest req, boolean enforcePolicy) {
        ensureTenantGuc();
        UUID currentTenantId = tenantContext.requireTenantId();
        AccountingPeriod period = periodRepo
                .findByTenantIdAndStartDateLessThanEqualAndEndDateGreaterThanEqual(
                        currentTenantId, req.entryDate(), req.entryDate())
                .orElseThrow(() -> new RuntimeException("No accounting period found for date: " + req.entryDate()));

        if (period.getStatus() != PeriodStatus.OPEN) {
            throw new PeriodLockedException(period.getId());
        }

        validateAccountCodes(currentTenantId, req);
        UUID branchId = requireBranchId(req.branchId());
        if (enforcePolicy) {
            authorization.authorizePostJournal(null, currentTenantId, branchId);
        }

        JournalEntry je = new JournalEntry();
        // NEVER set je.setId() — Spring Data calls merge() on non-null ID [03-02-B]
        je.setTenantId(tenantContext.requireTenantId());
        je.setPeriod(period);
        je.setEntryDate(req.entryDate());
        je.setDescription(req.description());
        je.setBranchId(branchId);
        je.setStatus(JeStatus.DRAFT);
        je.setSourceType(req.sourceType());
        je.setSourceId(req.sourceId());

        for (var lineReq : req.lines()) {
            JournalLine line = new JournalLine();
            line.setTenantId(je.getTenantId());
            line.setAccountCode(lineReq.accountCode());
            line.setDebitPaisa(lineReq.debitPaisa());
            line.setCreditPaisa(lineReq.creditPaisa());
            line.setDescription(lineReq.description());
            line.setJournalEntry(je);
            je.getLines().add(line);
        }

        return mapper.toDto(jeRepo.save(je));
        // NOTE: deferred trigger registered but NOT fired yet (fires at @Transactional commit)
    }

    /** User-facing posting: {@code post_journal} on the JE's OWN branch, then the mechanics. */
    @Override
    public JournalEntryDto post(UUID jeId) {
        ensureTenantGuc();
        JournalEntry target = jeRepo.findById(jeId)
                .orElseThrow(() -> new JeNotFoundException(jeId));
        authorization.authorizePostJournal(target.getId(), target.getTenantId(), target.getBranchId());
        return postInternal(jeId);
    }

    /** Mechanics only — NO authorization. Reachable from {@link #autoPostInternal}. */
    private JournalEntryDto postInternal(UUID jeId) {
        ensureTenantGuc();
        JournalEntry je = jeRepo.findById(jeId)
                .orElseThrow(() -> new JeNotFoundException(jeId));

        if (je.getStatus() != JeStatus.DRAFT) {
            throw new JeAlreadyPostedException(jeId);
        }

        AccountingPeriod period = je.getPeriod();
        if (period.getStatus() != PeriodStatus.OPEN) {
            throw new PeriodLockedException(period.getId());
        }

        int fiscalYear = period.getFiscalYear();
        UUID tenantId = je.getTenantId();
        ensureSequenceExists(tenantId, fiscalYear);
        jeSeqRepo.increment(tenantId, fiscalYear);
        int seq = jeSeqRepo.findLastSeq(tenantId, fiscalYear).orElse(1);
        je.setEntryNo("JE-" + fiscalYear + "-" + String.format("%06d", seq));
        je.setStatus(JeStatus.POSTED);
        je.setPostedBy(tenantContext.getUserId().orElse(null));

        jeRepo.save(je);
        publishJournalPosted(je);
        return mapper.toDto(je);
    }

    @Override
    public InternalJePostResponse autoPostInternal(InternalAutoPostJeRequest req) {
        ensureTenantGuc();
        UUID tenantId = tenantContext.requireTenantId();
        var existing = jeRepo.findByTenantIdAndSourceTypeAndSourceId(
                tenantId, req.sourceType(), req.sourceId());
        if (existing.isPresent()) {
            JournalEntry je = existing.get();
            return new InternalJePostResponse(je.getId(), je.getEntryNo());
        }

        // Deliberately createInternal/postInternal: this seam is authorized by the internal
        // shared-service secret at the controller, not by a user's finance.journal.post claim.
        JournalEntryDto draft = createInternal(new CreateJeRequest(
                req.entryDate(),
                req.description(),
                req.branchId(),
                req.sourceType(),
                req.sourceId(),
                req.lines()));
        JournalEntryDto posted = postInternal(draft.id());
        return new InternalJePostResponse(posted.id(), posted.entryNo());
    }

    @Override
    public JournalEntryDto reverse(UUID jeId) {
        ensureTenantGuc();
        JournalEntry orig = jeRepo.findById(jeId)
                .orElseThrow(() -> new JeNotFoundException(jeId));
        authorization.authorizeReverseJournal(orig.getId(), orig.getTenantId(), orig.getBranchId());

        if (orig.getStatus() != JeStatus.POSTED) {
            throw new IllegalStateException("Only POSTED JEs can be reversed");
        }
        if (orig.getReversedByJe() != null) {
            throw new IllegalStateException("JE already reversed");
        }

        AccountingPeriod period = orig.getPeriod();
        if (period.getStatus() != PeriodStatus.OPEN) {
            throw new PeriodLockedException(period.getId());
        }

        UUID tenantId = orig.getTenantId();
        JournalEntry rev = new JournalEntry();
        rev.setTenantId(tenantId);
        rev.setPeriod(period);
        rev.setEntryDate(LocalDate.now());
        rev.setDescription("Reversal of " + orig.getEntryNo());
        rev.setBranchId(orig.getBranchId());
        rev.setReversal(true);
        rev.setReversalOfJe(orig.getId());
        rev.setStatus(JeStatus.DRAFT);

        for (JournalLine origLine : orig.getLines()) {
            JournalLine revLine = new JournalLine();
            revLine.setTenantId(tenantId);
            revLine.setAccountCode(origLine.getAccountCode());
            // Swap debit/credit for reversal
            revLine.setDebitPaisa(origLine.getCreditPaisa());
            revLine.setCreditPaisa(origLine.getDebitPaisa());
            revLine.setDescription("Reversal: " + origLine.getDescription());
            revLine.setJournalEntry(rev);
            rev.getLines().add(revLine);
        }
        jeRepo.save(rev);

        int fiscalYear = period.getFiscalYear();
        ensureSequenceExists(tenantId, fiscalYear);
        jeSeqRepo.increment(tenantId, fiscalYear);
        int seq = jeSeqRepo.findLastSeq(tenantId, fiscalYear).orElse(1);
        rev.setEntryNo("REV-" + fiscalYear + "-" + String.format("%06d", seq));
        rev.setStatus(JeStatus.POSTED);
        rev.setPostedBy(tenantContext.getUserId().orElse(null));
        jeRepo.save(rev);

        // Link original -> reversal (ONLY allowed UPDATE on POSTED JE via immutability trigger exemption)
        orig.setReversedByJe(rev.getId());
        jeRepo.save(orig);

        return mapper.toDto(rev);
    }

    @Override
    @Transactional(readOnly = true)
    public JournalEntryDto getById(UUID jeId) {
        ensureTenantGuc();
        JournalEntry je = jeRepo.findById(jeId).orElseThrow(() -> new JeNotFoundException(jeId));
        // findById is branch-blind — the same shape as EmployeeService.load. view_journal is
        // same_tenant_and_branch, so the JE's OWN branch is what the policy must be asked about.
        authorization.authorizeViewJournal(je.getId(), je.getTenantId(), je.getBranchId());
        return mapper.toDto(je);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<JournalEntryDto> listByPeriod(UUID periodId, Pageable pageable) {
        ensureTenantGuc();
        UUID branchId = requireBranchId(null);
        authorization.authorizeViewJournal(null, tenantContext.requireTenantId(), branchId);
        return jeRepo.findByPeriodIdAndBranchId(periodId, branchId, pageable).map(mapper::toDto);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<JournalEntryDto> listByDateRange(LocalDate from, LocalDate to, Pageable pageable) {
        ensureTenantGuc();
        UUID branchId = requireBranchId(null);
        authorization.authorizeViewJournal(null, tenantContext.requireTenantId(), branchId);
        return jeRepo.findByEntryDateBetweenAndBranchId(from, to, branchId, pageable)
                .map(mapper::toDto);
    }

    /**
     * 37-04 / D-37-01: the ledger half of "where did this number come from?".
     *
     * <p>Not filtered by branch, unlike the list reads above. A journal entry's branch and the
     * branch the caller is currently scoped to are different questions, and an owner tracing an
     * order must see every entry that order produced or the answer is a partial one wearing the
     * costume of a complete one. Tenant isolation is unaffected: it comes from the FORCE RLS
     * policy on journal_entries, which no application code can opt out of.
     */
    @Override
    @Transactional(readOnly = true)
    public List<JournalEntryDto> listBySource(UUID sourceId, String sourceType) {
        ensureTenantGuc();
        authorization.authorizeViewJournal(null, tenantContext.requireTenantId(), requireBranchId(null));
        List<JournalEntry> entries = (sourceType == null || sourceType.isBlank())
                ? jeRepo.findAllBySourceId(sourceId)
                : jeRepo.findAllBySourceIdAndSourceType(sourceId, sourceType);
        return entries.stream().map(mapper::toDto).toList();
    }

    private void ensureSequenceExists(UUID tenantId, int fiscalYear) {
        if (jeSeqRepo.findLastSeq(tenantId, fiscalYear).isEmpty()) {
            JeSequence seq = new JeSequence();
            seq.setTenantId(tenantId);
            seq.setFiscalYear(fiscalYear);
            seq.setLastSeq(0);
            try {
                jeSeqRepo.save(seq);
            } catch (DataIntegrityViolationException e) {
                // Race condition on first JE — another thread beat us, ignore
            }
        }
    }

    private void publishJournalPosted(JournalEntry je) {
        long totalDebit = je.getLines().stream().mapToLong(JournalLine::getDebitPaisa).sum();
        long totalCredit = je.getLines().stream().mapToLong(JournalLine::getCreditPaisa).sum();
        Map<String, Object> payload = new HashMap<>();
        payload.put("jeId", je.getId());
        payload.put("entryNo", je.getEntryNo());
        payload.put("sourceType", je.getSourceType() != null ? je.getSourceType() : "");
        if (je.getSourceId() != null) {
            payload.put("sourceId", je.getSourceId());
        }
        payload.put("totalDebitPaisa", totalDebit);
        payload.put("totalCreditPaisa", totalCredit);
        eventPublisher.publish(
                FINANCE_EXCHANGE,
                JOURNAL_POSTED_KEY,
                JOURNAL_POSTED_TYPE,
                je.getBranchId(),
                payload);
    }
}
