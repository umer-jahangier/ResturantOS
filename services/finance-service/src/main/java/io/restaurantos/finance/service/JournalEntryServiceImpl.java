package io.restaurantos.finance.service;

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

    public JournalEntryServiceImpl(JournalEntryRepository jeRepo,
                                    AccountingPeriodRepository periodRepo,
                                    ChartOfAccountRepository coaRepo,
                                    JeSequenceRepository jeSeqRepo,
                                    JournalEntryMapper mapper,
                                    TenantContext tenantContext,
                                    EventPublisher eventPublisher,
                                    EntityManager entityManager) {
        this.jeRepo = jeRepo;
        this.periodRepo = periodRepo;
        this.coaRepo = coaRepo;
        this.jeSeqRepo = jeSeqRepo;
        this.mapper = mapper;
        this.tenantContext = tenantContext;
        this.eventPublisher = eventPublisher;
        this.entityManager = entityManager;
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

    @Override
    public JournalEntryDto create(CreateJeRequest req) {
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

    @Override
    public JournalEntryDto post(UUID jeId) {
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

        JournalEntryDto draft = create(new CreateJeRequest(
                req.entryDate(),
                req.description(),
                req.branchId(),
                req.sourceType(),
                req.sourceId(),
                req.lines()));
        JournalEntryDto posted = post(draft.id());
        return new InternalJePostResponse(posted.id(), posted.entryNo());
    }

    @Override
    public JournalEntryDto reverse(UUID jeId) {
        ensureTenantGuc();
        JournalEntry orig = jeRepo.findById(jeId)
                .orElseThrow(() -> new JeNotFoundException(jeId));

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
        return jeRepo.findById(jeId)
                .map(mapper::toDto)
                .orElseThrow(() -> new JeNotFoundException(jeId));
    }

    @Override
    @Transactional(readOnly = true)
    public Page<JournalEntryDto> listByPeriod(UUID periodId, Pageable pageable) {
        ensureTenantGuc();
        UUID branchId = requireBranchId(null);
        return jeRepo.findByPeriodIdAndBranchId(periodId, branchId, pageable).map(mapper::toDto);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<JournalEntryDto> listByDateRange(LocalDate from, LocalDate to, Pageable pageable) {
        ensureTenantGuc();
        UUID branchId = requireBranchId(null);
        return jeRepo.findByEntryDateBetweenAndBranchId(from, to, branchId, pageable)
                .map(mapper::toDto);
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
