package io.restaurantos.pos.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.enums.PrintJobStatus;
import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.pos.repository.PrintJobRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class PrintJobServiceImpl implements PrintJobService {

    private final PrintJobRepository printJobRepository;
    private final ReceiptDocumentAssembler assembler;
    private final TenantContext tenantContext;
    private final ObjectMapper objectMapper;
    /**
     * Read ONLY to answer "is anything on this branch in a position to print this". Nothing here
     * enrols, revokes or authenticates an agent — see {@link PrintAgentEnrolmentService#presence}
     * for why the answer travels on this response rather than on the admin list.
     */
    private final PrintAgentEnrolmentService agents;

    public PrintJobServiceImpl(PrintJobRepository printJobRepository,
                               ReceiptDocumentAssembler assembler,
                               TenantContext tenantContext,
                               ObjectMapper objectMapper,
                               PrintAgentEnrolmentService agents) {
        this.printJobRepository = printJobRepository;
        this.assembler = assembler;
        this.tenantContext = tenantContext;
        this.objectMapper = objectMapper;
        this.agents = agents;
    }

    @Override
    @Transactional
    public IssuedDocument issue(UUID orderId, UUID branchId, String idempotencyKey) {
        return issueReceipt(orderId, branchId, idempotencyKey, PrintJobStatus.ISSUED);
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public IssuedDocument enqueueReceipt(UUID orderId, UUID branchId, String idempotencyKey) {
        return issueReceipt(orderId, branchId, idempotencyKey, PrintJobStatus.QUEUED);
    }

    /**
     * The ONE write path for a customer receipt. {@code issue} and {@code enqueueReceipt} differ by
     * a single field — the status the row lands in — and share everything that could get the
     * document wrong: the reprint bytes, the sequence lock and the stamping.
     */
    private IssuedDocument issueReceipt(UUID orderId, UUID branchId, String idempotencyKey,
                                        PrintJobStatus status) {
        UUID tenantId = tenantContext.requireTenantId();

        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            Optional<PrintJob> replay = printJobRepository.findByIdempotencyKey(tenantId, idempotencyKey);
            if (replay.isPresent()) {
                // A retried POST is the SAME issue, not another one. Without this the reprint
                // count becomes fiction the moment a network blips mid-settlement.
                return toIssued(replay.get());
            }
        }

        PrintDocument.DocumentType type = PrintDocument.DocumentType.CUSTOMER_RECEIPT;

        // The FIRST issue for this order and document type decides the routing slot; every later
        // issue must land in the same one, or a printer-configuration change between the original
        // and the reprint would start a second sequence at 1 and the reprint would claim to be an
        // original.
        Optional<PrintJob> anyExisting = printJobRepository.findHistoryForOrder(tenantId, orderId)
                .stream().filter(j -> j.getDocumentType() == type).findFirst();

        String targetPrinterId;
        String body;
        Instant originalIssuedAt;

        if (anyExisting.isPresent()) {
            PrintJob first = printJobRepository
                    .findFirstIssue(tenantId, orderId, type, anyExisting.get().getTargetPrinterId())
                    .orElse(anyExisting.get());
            targetPrinterId = first.getTargetPrinterId();
            // THE SAME BYTES. The assembler is not called.
            body = first.getDocument();
            originalIssuedAt = first.getIssuedAt();
        } else {
            ReceiptDocumentAssembler.Assembled assembled = assembler.assembleReceipt(orderId, branchId);
            targetPrinterId = assembled.targetPrinterId();
            body = serialise(assembled.document());
            originalIssuedAt = null;
        }

        int nextSeq = nextSequence(tenantId, orderId, type, targetPrinterId);
        Instant issuedAt = stampNow();

        PrintDocument stamped = restamp(body, nextSeq, nextSeq > 1, issuedAt, originalIssuedAt);

        /*
         * A ROUTED issue is QUEUED, even when the caller asked for ISSUED.
         *
         * `issue` is the "Print bill" button. It shipped writing an ISSUED row, and the agent's
         * work query selects `status = 'QUEUED'` — so pressing Print bill on a branch WITH a
         * receipt printer wrote a row the agent would never claim, and the only paper that could
         * ever appear was the browser's own print dialog. That is the whole of the register's
         * "window.print() count 2, agent calls 0" observation, from the other end.
         *
         * ISSUED survives for the one case it is true of: a branch with no receipt printer, where
         * `targetPrinterId` is the UNASSIGNED sentinel. There the document exists, the row records
         * that it was handed over, and the browser bill is the honest and only path (D-26-01).
         */
        PrintJobStatus effectiveStatus =
                status == PrintJobStatus.ISSUED && !PrintJob.UNASSIGNED_TARGET.equals(targetPrinterId)
                        ? PrintJobStatus.QUEUED
                        : status;

        PrintJob job = new PrintJob();
        job.setTenantId(tenantId);
        job.setBranchId(branchId);
        job.setOrderId(orderId);
        job.setDocumentType(type);
        job.setTargetPrinterId(targetPrinterId);
        job.setIssueSeq(nextSeq);
        job.setStatus(effectiveStatus);
        // The body stored on a reprint row is the reprint's own document — stamped, so a later
        // re-serve of THIS row shows the reprint metadata it was printed with. The ORIGINAL bytes
        // remain on the sequence-1 row and are what every future reprint copies.
        job.setDocument(serialise(stamped));
        job.setIssuedAt(issuedAt);
        job.setOriginalIssuedAt(nextSeq > 1 ? originalIssuedAt : null);
        job.setIdempotencyKey(idempotencyKey == null || idempotencyKey.isBlank() ? null : idempotencyKey);

        PrintJob saved = printJobRepository.saveAndFlush(job);
        return new IssuedDocument(saved.getId(), targetPrinterId, stamped, effectiveStatus,
                agents.presence(branchId));
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public UUID enqueueKitchenTicket(UUID orderId, UUID branchId, String targetPrinterId,
                                     int revisionNo, PrintDocument document,
                                     PrintJobStatus status, String lastError) {
        UUID tenantId = tenantContext.requireTenantId();
        PrintDocument.DocumentType type = PrintDocument.DocumentType.KITCHEN_TICKET;

        int nextSeq = nextSequence(tenantId, orderId, type, targetPrinterId);
        Instant issuedAt = stampNow();
        // Sequence > 1 for a kitchen ticket means the SAME station is being re-issued for the same
        // order — a manual reprint of a lost ticket, not a new fire (a new fire carries a new
        // revision). Stamping it as a reprint is what puts "*** REPRINT #2 ***" on the paper, so a
        // cook does not cook it twice.
        PrintDocument stamped = restamp(serialise(document), nextSeq, nextSeq > 1, issuedAt,
                nextSeq > 1 ? firstIssuedAt(tenantId, orderId, type, targetPrinterId) : null);

        PrintJob job = new PrintJob();
        job.setTenantId(tenantId);
        job.setBranchId(branchId);
        job.setOrderId(orderId);
        job.setDocumentType(type);
        job.setTargetPrinterId(targetPrinterId);
        job.setIssueSeq(nextSeq);
        job.setRevisionNo(revisionNo);
        job.setStatus(status);
        job.setLastError(lastError);
        job.setDocument(serialise(stamped));
        job.setIssuedAt(issuedAt);

        // saveAndFlush, not save: the unique index on (tenant, order, type, target, revision) must
        // speak NOW, inside this transaction, rather than at an implicit flush the caller cannot
        // see. It is the after-commit dispatch's only idempotency guard.
        return printJobRepository.saveAndFlush(job).getId();
    }

    @Override
    @Transactional
    public List<IssuedDocument> reprintKitchenTickets(UUID orderId, UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        PrintDocument.DocumentType type = PrintDocument.DocumentType.KITCHEN_TICKET;

        // One reprint per ROUTING SLOT, not per row. A two-station order that has been fired three
        // times has six rows and two printers; the cook who lost the hot-pass ticket wants one
        // ticket per station, not six.
        List<String> targets = printJobRepository.findHistoryForOrder(tenantId, orderId).stream()
                .filter(j -> j.getDocumentType() == type)
                .map(PrintJob::getTargetPrinterId)
                // A station that had no printer when it fired wrote a FAILED row against the
                // sentinel target. Reprinting to nowhere would write a second row that also goes
                // nowhere; the manager needs the Printers screen, not more paper.
                .filter(t -> t != null && !PrintJob.UNASSIGNED_TARGET.equals(t))
                .distinct()
                .toList();

        // ONE presence read for the whole reprint, not one per station: the answer is a property of
        // the branch, and a per-row read would make a six-station reprint six identical queries.
        PrintAgentEnrolmentService.Presence presence = agents.presence(branchId);

        List<IssuedDocument> reprinted = new ArrayList<>();
        for (String target : targets) {
            PrintJob first = printJobRepository.findFirstIssue(tenantId, orderId, type, target)
                    .orElse(null);
            if (first == null) {
                continue;
            }
            int nextSeq = nextSequence(tenantId, orderId, type, target);
            Instant issuedAt = stampNow();
            // THE SAME BYTES the kitchen was originally given, restamped as a reprint so the
            // renderer bands it and a cook does not cook the order twice.
            PrintDocument stamped = restamp(first.getDocument(), nextSeq, true, issuedAt,
                    first.getIssuedAt());

            PrintJob job = new PrintJob();
            job.setTenantId(tenantId);
            job.setBranchId(branchId);
            job.setOrderId(orderId);
            job.setDocumentType(type);
            job.setTargetPrinterId(target);
            job.setIssueSeq(nextSeq);
            // NULL, not the original revision — see the interface note on uq_print_jobs_revision.
            job.setRevisionNo(null);
            job.setStatus(PrintJobStatus.QUEUED);
            job.setDocument(serialise(stamped));
            job.setIssuedAt(issuedAt);
            job.setOriginalIssuedAt(first.getIssuedAt());

            PrintJob saved = printJobRepository.saveAndFlush(job);
            reprinted.add(new IssuedDocument(saved.getId(), target, stamped,
                    PrintJobStatus.QUEUED, presence));
        }
        return reprinted;
    }

    /**
     * Now, at the precision the database can actually keep.
     *
     * <p>Postgres {@code timestamptz} holds microseconds; {@code Instant.now()} carries
     * nanoseconds. Stamping the raw value made a document's own {@code issuedAt} differ from the
     * one persisted alongside it in the sub-microsecond digits — so a reprint, which reads the
     * first issue back through the repository, reported an {@code originalIssuedAt} that did not
     * equal the original document's {@code issuedAt}. Whether that reread came from the database
     * or from Hibernate's first-level cache decided which value you got, which is why
     * {@code PrintJobIssuanceIT.reprint_isByteIdenticalApartFromIssueMetadata} failed only
     * sometimes. Truncating here makes the stamp survive a round trip unchanged.
     */
    private static Instant stampNow() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    private Instant firstIssuedAt(UUID tenantId, UUID orderId, PrintDocument.DocumentType type,
                                  String target) {
        return printJobRepository.findFirstIssue(tenantId, orderId, type, target)
                .map(PrintJob::getIssuedAt)
                .orElse(stampNow());
    }

    @Override
    @Transactional(readOnly = true)
    public IssuedDocument fetch(UUID printJobId) {
        UUID tenantId = tenantContext.requireTenantId();
        PrintJob job = printJobRepository.findScoped(tenantId, printJobId)
                .orElseThrow(() -> new ResourceNotFoundException("Print job not found: " + printJobId));
        return toIssued(job);
    }

    /**
     * The next sequence for one routing slot, taken under a pessimistic write lock.
     *
     * <p>Two cashiers hitting Reprint at the same moment would otherwise both read n and both write
     * n+1; the unique index would turn one of them into a 500 the cashier cannot act on. The index
     * is still there as the backstop — this is the fast path that keeps it from firing.
     */
    private int nextSequence(UUID tenantId, UUID orderId, PrintDocument.DocumentType type, String target) {
        List<PrintJob> existing = printJobRepository.lockSlotForSequence(tenantId, orderId, type, target);
        return existing.isEmpty() ? 1 : existing.get(0).getIssueSeq() + 1;
    }

    private IssuedDocument toIssued(PrintJob job) {
        return new IssuedDocument(job.getId(), job.getTargetPrinterId(),
                deserialise(job.getDocument()), job.getStatus(), agents.presence(job.getBranchId()));
    }

    /**
     * The stored body with new issue metadata, and NOTHING else changed.
     *
     * <p>A record {@code with}-style copy rather than a re-assembly: every other component — every
     * line, every amount, every string — is carried across by reference from the deserialised
     * original, so "identical apart from the issue metadata" is true by construction rather than by
     * inspection.
     */
    private PrintDocument restamp(String body, int seq, boolean reprint, Instant issuedAt, Instant originalIssuedAt) {
        PrintDocument original = deserialise(body);
        PrintDocument.Issue issue = new PrintDocument.Issue(
                seq,
                reprint,
                issuedAt,
                // Issue's own compact constructor refuses a reprint with no original timestamp,
                // so this is not merely a convention.
                reprint ? (originalIssuedAt != null ? originalIssuedAt : original.issue().issuedAt()) : null);
        return new PrintDocument(
                original.schemaVersion(), original.type(), original.provenance(),
                original.tenantId(), original.branchId(), original.orderId(), original.orderNo(),
                issue,
                original.header(), original.ticket(),
                original.lines(), original.totals(), original.taxBreakdown(),
                original.tenders(), original.fiscal(), original.drawer(), original.cut(),
                original.footer());
    }

    private String serialise(PrintDocument document) {
        try {
            return objectMapper.writeValueAsString(document);
        } catch (JsonProcessingException e) {
            throw new StateInvalidException("Print document could not be serialised: " + e.getOriginalMessage());
        }
    }

    private PrintDocument deserialise(String body) {
        try {
            return objectMapper.readValue(body, PrintDocument.class);
        } catch (JsonProcessingException e) {
            // Loud, not empty. A stored document that cannot be read is not "no receipt" — it is a
            // receipt somebody was handed and we can no longer reproduce.
            throw new StateInvalidException("Stored print document is unreadable: " + e.getOriginalMessage());
        }
    }
}
