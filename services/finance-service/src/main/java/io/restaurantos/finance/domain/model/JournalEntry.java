package io.restaurantos.finance.domain.model;

import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "journal_entries")
@Getter
@Setter
public class JournalEntry extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "entry_no", length = 30)
    private String entryNo;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "period_id", nullable = false)
    private AccountingPeriod period;

    @Column(name = "entry_date", nullable = false)
    private LocalDate entryDate;

    @Column(name = "description", length = 500)
    private String description;

    @Column(name = "source_type", length = 50)
    private String sourceType;

    @Column(name = "source_id")
    private UUID sourceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 10)
    private JeStatus status = JeStatus.DRAFT;

    @Column(name = "posted_by")
    private UUID postedBy;

    @Column(name = "reversal", nullable = false)
    private boolean reversal = false;

    @Column(name = "reversal_of_je")
    private UUID reversalOfJe;

    @Column(name = "reversed_by_je")
    private UUID reversedByJe;

    @OneToMany(mappedBy = "journalEntry", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<JournalLine> lines = new ArrayList<>();
}
