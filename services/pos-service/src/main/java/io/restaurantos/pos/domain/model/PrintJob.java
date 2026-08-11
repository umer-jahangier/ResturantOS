package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.PrintJobStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import io.restaurantos.shared.print.PrintDocument;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * One issue of one document. See {@code V13__print_jobs.sql} for why this table exists and why its
 * indexes are shaped the way they are.
 */
@Entity
@Table(name = "print_jobs")
@Getter
@Setter
public class PrintJob extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    /** NULL means the branch default printer for this role (D-26-05). */
    @Column(name = "terminal_id")
    private UUID terminalId;

    @Column(name = "order_id", nullable = false)
    private UUID orderId;

    @Enumerated(EnumType.STRING)
    @Column(name = "document_type", nullable = false, length = 30)
    private PrintDocument.DocumentType documentType;

    /**
     * The {@code PrinterEntry.id} from the branch's receipt configuration, or
     * {@link #UNASSIGNED_TARGET} when the branch has no printer configured. Part of the sequence
     * key: a kitchen fire writes one row per station for one order and one document type, and a
     * key without the target would make a two-station fire collide with itself.
     */
    @Column(name = "target_printer_id", nullable = false, length = 64)
    private String targetPrinterId = UNASSIGNED_TARGET;

    /**
     * The sentinel target for a branch with no printer configured. Not null and not the empty
     * string: this value is half of a unique key, and NULL in a unique index means "never equal to
     * anything", which would silently let a branch with no printer allocate sequence 1 forever.
     */
    public static final String UNASSIGNED_TARGET = "unassigned";

    /** 1 for the first issue; 2, 3, … for reprints. Scoped to (tenant, order, type, target). */
    @Column(name = "issue_seq", nullable = false)
    private int issueSeq;

    /** NULL for a customer receipt; the order-item revision for a kitchen ticket (26-07). */
    @Column(name = "revision_no")
    private Integer revisionNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private PrintJobStatus status = PrintJobStatus.ISSUED;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "last_error")
    private String lastError;

    /**
     * The serialised {@link PrintDocument}. A reprint re-serves THESE BYTES — it does not re-run
     * the assembler, because re-assembling would let a later price edit or a menu rename change a
     * document the customer is already holding.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "document", columnDefinition = "jsonb", nullable = false)
    private String document;

    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt;

    /** Set on a reprint to the first issue's timestamp; NULL on an original. */
    @Column(name = "original_issued_at")
    private Instant originalIssuedAt;

    @Column(name = "idempotency_key", length = 120)
    private String idempotencyKey;

    /**
     * The agent currently holding this job (26-11). Recorded so a late acknowledgement from an
     * agent whose lease already expired can be refused: if the sweep handed the job to a sibling
     * agent, marking it PRINTED here would mark as done a job the sibling is still printing.
     */
    @Column(name = "claimed_by_agent_id")
    private UUID claimedByAgentId;

    /** When the current claim stops being valid. Null unless {@code status == CLAIMED}. */
    @Column(name = "lease_expires_at")
    private Instant leaseExpiresAt;

    /** Server-side backoff. Null means claimable now. */
    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;
}
