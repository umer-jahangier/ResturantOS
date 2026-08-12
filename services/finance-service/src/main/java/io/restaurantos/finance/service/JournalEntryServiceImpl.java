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
import io.restaurantos.finance.dto.SourceReferenceDto;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
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
    private final SourceReferenceResolver sourceReferenceResolver;

    public JournalEntryServiceImpl(JournalEntryRepository jeRepo,
                                    AccountingPeriodRepository periodRepo,
                                    ChartOfAccountRepository coaRepo,
                                    JeSequenceRepository jeSeqRepo,
                                    JournalEntryMapper mapper,
                                    TenantContext tenantContext,
                                    EventPublisher eventPublisher,
                                    EntityManager entityManager,
                                    FinanceAuthorizationService authorization,
                                    SourceReferenceResolver sourceReferenceResolver) {
        this.jeRepo = jeRepo;
        this.periodRepo = periodRepo;
        this.coaRepo = coaRepo;
        this.jeSeqRepo = jeSeqRepo;
        this.mapper = mapper;
        this.tenantContext = tenantContext;
        this.eventPublisher = eventPublisher;
        this.entityManager = entityManager;
        this.authorization = authorization;
        this.sourceReferenceResolver = sourceReferenceResolver;
    }

    private void ensureTenantGuc() {
        TenantGucHelper.apply(entityManager, tenantContext);
    }

    /**
     * Branch for a branch-scoped READ. The listing queries are anchored on a branch, so they
     * cannot run without one. See {@link #resolveBranchForNewEntry} for the write path, where a
     * branch is optional.
     *
     * <p>Deliberately still throws for a session with no branch, rather than falling back to a
     * tenant-wide listing. No interactive user has a branch-less session: {@code
     * PermissionResolver.selectDefaultBranch} always resolves one and throws "User has no active
     * branch assignments" otherwise, so a null branch here means a service-to-service context,
     * which has no business paging the ledger. Silently promoting that to "show every branch"
     * would invent a cross-branch capability no real caller needs and hand it to machine contexts
     * by default. A genuine tenant-wide finance view should be an explicit, permission-gated
     * scope, not an accident of a null claim.
     */
    private UUID requireBranchId(UUID requestedBranchId) {
        UUID contextBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new IllegalStateException("Branch context required"));
        if (requestedBranchId != null && !requestedBranchId.equals(contextBranchId)) {
            throw new IllegalStateException("Branch mismatch with active session");
        }
        return contextBranchId;
    }

    /**
     * Branch for a NEW journal entry, which may legitimately have none.
     *
     * <p>A journal entry is not inherently branch-scoped: month-end accruals and corporate
     * adjustments belong to the tenant, not to any one restaurant. Every layer already says so —
     * {@code journal_entries.branch_id} is nullable directly beneath a {@code tenant_id NOT NULL},
     * {@code JournalEntry} declares {@code @Column(name = "branch_id")} with no
     * {@code nullable = false}, and {@code CreateJeRequest.branchId} carries no {@code @NotNull}
     * while {@code entryDate} and {@code lines} do. Only this service disagreed: routing creates
     * through {@link #requireBranchId} demanded a session branch and made that nullable column
     * unreachable, so a tenant-level entry could not be posted at all.
     *
     * <p>Isolation is unchanged and still fail-closed. An explicit branch must match the session's,
     * and a caller with no branch in context may not name one, so this cannot write into a branch
     * the caller does not belong to. The only new behaviour is that no branch anywhere yields a
     * tenant-level entry instead of an exception.
     *
     * @return the branch to record, or null for a tenant-level entry
     */
    private UUID resolveBranchForNewEntry(UUID requestedBranchId) {
        UUID contextBranchId = tenantContext.getBranchId().orElse(null);
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
        // Same seam as enforcePolicy, for the same reason. An interactive create takes its branch
        // from the session (optional — null means a tenant-level entry). The internal auto-posting
        // path arrives with a TENANT-ONLY context and the CALLER names the branch, because POS
        // knows which branch its sale belongs to; matching that against a session branch which
        // deliberately does not exist would reject every automatic posting.
        UUID branchId = enforcePolicy ? resolveBranchForNewEntry(req.branchId()) : req.branchId();
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
        // 37-04: the SINGLE-entry read always resolves. This is the "open one entry and see where
        // it came from" path, it is exactly one lookup, and the resolver degrades to an explicit
        // state rather than throwing — so the entry comes back complete either way.
        return mapper.toDto(je)
                .withSourceReference(sourceReferenceResolver.resolve(je.getSourceType(), je.getSourceId()));
    }

    @Override
    @Transactional(readOnly = true)
    public Page<JournalEntryDto> listByPeriod(UUID periodId, Pageable pageable) {
        ensureTenantGuc();
        UUID branchId = requireBranchId(null);
        authorization.authorizeViewJournal(null, tenantContext.requireTenantId(), branchId);
        return jeRepo.findByPeriodIdVisibleToBranch(periodId, branchId, newestFirst(pageable))
                .map(mapper::toDto);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<JournalEntryDto> listByDateRange(LocalDate from, LocalDate to, Pageable pageable) {
        ensureTenantGuc();
        UUID branchId = requireBranchId(null);
        authorization.authorizeViewJournal(null, tenantContext.requireTenantId(), branchId);
        return jeRepo.findByEntryDateBetweenVisibleToBranch(from, to, branchId, newestFirst(pageable))
                .map(mapper::toDto);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<JournalEntryDto> search(String term, Pageable pageable) {
        ensureTenantGuc();
        UUID branchId = requireBranchId(null);
        authorization.authorizeViewJournal(null, tenantContext.requireTenantId(), branchId);
        return jeRepo.searchByBranch(branchId, escapeLikeTerm(term.trim()), newestFirst(pageable))
                .map(mapper::toDto);
    }

    /**
     * A {@code %} or {@code _} the user typed is text they are looking for, not a wildcard they
     * asked for. Unescaped, a search for "50%" matched every entry in the ledger — a result that
     * looks like the filter was ignored rather than like a bad match, which is the worst kind of
     * wrong answer on a money screen. The backslash goes first, or it would double-escape the
     * escapes this adds. Paired with {@code ESCAPE '\'} on the query itself.
     */
    private static String escapeLikeTerm(String term) {
        return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    /**
     * Newest entry first, and — the load-bearing half — DETERMINISTIC.
     *
     * <p>Every paginated journal read here used to run with whatever {@code Pageable} the
     * controller's {@code @PageableDefault(size = 50)} produced, which carries NO sort. PostgreSQL
     * is then free to return the 254 rows of a busy branch's month in any order it likes, and
     * {@code LIMIT 50} takes an arbitrary 50 of them. Measured on live data: page 1 ended at
     * {@code JE-2027-000065} while the newest entry was {@code JE-2027-000256}, so an owner who
     * settled a check and opened the ledger could not see the entry it had just posted — the row
     * was not late, it was on some other page, and the screen offers no way to reach one.
     * {@code LIMIT}/{@code OFFSET} without {@code ORDER BY} is also free to repeat and skip rows
     * between pages, so paging through was never going to find it either.
     *
     * <p>{@code entryNo} breaks the tie within a date. It is a zero-padded sequence per fiscal
     * year, so lexical descending is chronological descending. A caller that asks for its own sort
     * still gets it — this only supplies one where there was none.
     */
    private static Pageable newestFirst(Pageable pageable) {
        if (pageable.getSort().isSorted()) {
            return pageable;
        }
        return PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                Sort.by(Sort.Order.desc("entryDate"), Sort.Order.desc("entryNo")));
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
        return listBySource(sourceId, sourceType, false);
    }

    @Override
    @Transactional(readOnly = true)
    public List<JournalEntryDto> listBySource(UUID sourceId, String sourceType, boolean resolveSource) {
        ensureTenantGuc();
        authorization.authorizeViewJournal(null, tenantContext.requireTenantId(), requireBranchId(null));
        List<JournalEntry> entries = (sourceType == null || sourceType.isBlank())
                ? jeRepo.findAllBySourceId(sourceId)
                : jeRepo.findAllBySourceIdAndSourceType(sourceId, sourceType);

        // Every entry here shares ONE source id, so ONE lookup serves all of them however many
        // came back. But each entry keeps its OWN sourceType on its reference: a revenue entry and
        // a cost-of-sales entry from the same order are not interchangeable, and a client
        // branching on sourceReference.sourceType would otherwise be told the COGS entry was a
        // revenue entry. Same order, same order number — different reason for existing.
        if (resolveSource && !entries.isEmpty()) {
            SourceReferenceDto shared = sourceReferenceResolver.resolve(
                    entries.get(0).getSourceType(), entries.get(0).getSourceId());
            return entries.stream()
                    .map(e -> mapper.toDto(e).withSourceReference(shared.forSourceType(e.getSourceType())))
                    .toList();
        }
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
