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
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class PrintJobServiceImpl implements PrintJobService {

    private final PrintJobRepository printJobRepository;
    private final ReceiptDocumentAssembler assembler;
    private final TenantContext tenantContext;
    private final ObjectMapper objectMapper;

    public PrintJobServiceImpl(PrintJobRepository printJobRepository,
                               ReceiptDocumentAssembler assembler,
                               TenantContext tenantContext,
                               ObjectMapper objectMapper) {
        this.printJobRepository = printJobRepository;
        this.assembler = assembler;
        this.tenantContext = tenantContext;
        this.objectMapper = objectMapper;
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
        Instant issuedAt = Instant.now();

        PrintDocument stamped = restamp(body, nextSeq, nextSeq > 1, issuedAt, originalIssuedAt);

        PrintJob job = new PrintJob();
        job.setTenantId(tenantId);
        job.setBranchId(branchId);
        job.setOrderId(orderId);
        job.setDocumentType(type);
        job.setTargetPrinterId(targetPrinterId);
        job.setIssueSeq(nextSeq);
        job.setStatus(status);
        // The body stored on a reprint row is the reprint's own document — stamped, so a later
        // re-serve of THIS row shows the reprint metadata it was printed with. The ORIGINAL bytes
        // remain on the sequence-1 row and are what every future reprint copies.
        job.setDocument(serialise(stamped));
        job.setIssuedAt(issuedAt);
        job.setOriginalIssuedAt(nextSeq > 1 ? originalIssuedAt : null);
        job.setIdempotencyKey(idempotencyKey == null || idempotencyKey.isBlank() ? null : idempotencyKey);

        PrintJob saved = printJobRepository.saveAndFlush(job);
        return new IssuedDocument(saved.getId(), targetPrinterId, stamped);
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public UUID enqueueKitchenTicket(UUID orderId, UUID branchId, String targetPrinterId,
                                     int revisionNo, PrintDocument document,
                                     PrintJobStatus status, String lastError) {
        UUID tenantId = tenantContext.requireTenantId();
        PrintDocument.DocumentType type = PrintDocument.DocumentType.KITCHEN_TICKET;

        int nextSeq = nextSequence(tenantId, orderId, type, targetPrinterId);
        Instant issuedAt = Instant.now();
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

    private Instant firstIssuedAt(UUID tenantId, UUID orderId, PrintDocument.DocumentType type,
                                  String target) {
        return printJobRepository.findFirstIssue(tenantId, orderId, type, target)
                .map(PrintJob::getIssuedAt)
                .orElse(Instant.now());
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
        return new IssuedDocument(job.getId(), job.getTargetPrinterId(), deserialise(job.getDocument()));
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
