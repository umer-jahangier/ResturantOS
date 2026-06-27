package io.restaurantos.finance.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "journal_lines")
@Getter
@Setter
public class JournalLine extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "je_id", nullable = false)
    private JournalEntry journalEntry;

    @Column(name = "account_code", nullable = false, length = 20)
    private String accountCode;

    @Column(name = "description", length = 500)
    private String description;

    @Column(name = "debit_paisa", nullable = false)
    private long debitPaisa = 0;

    @Column(name = "credit_paisa", nullable = false)
    private long creditPaisa = 0;
}
