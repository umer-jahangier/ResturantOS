package io.restaurantos.finance.domain.model;

import io.restaurantos.finance.domain.enums.ArTxnType;
import io.restaurantos.shared.entity.TenantAuditableEntity;
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

import java.time.LocalDate;
import java.util.UUID;

/**
 * The AR sub-ledger. journal_entry_id is NOT NULL by design (V6): an ar_transaction
 * that never hit the ledger must be unrepresentable.
 */
@Entity
@Table(name = "ar_transactions")
@Getter
@Setter
public class ArTransaction extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "customer_account_id", nullable = false)
    private UUID customerAccountId;

    @Enumerated(EnumType.STRING)
    @Column(name = "txn_type", nullable = false, length = 20)
    private ArTxnType txnType;

    @Column(name = "txn_date", nullable = false)
    private LocalDate txnDate;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "amount_paisa", nullable = false)
    private long amountPaisa;

    @Column(name = "source_type", nullable = false, length = 30)
    private String sourceType;

    @Column(name = "source_id")
    private UUID sourceId;

    @Column(name = "journal_entry_id", nullable = false)
    private UUID journalEntryId;

    @Column(name = "reference", length = 200)
    private String reference;

    @Column(name = "memo", length = 500)
    private String memo;
}
