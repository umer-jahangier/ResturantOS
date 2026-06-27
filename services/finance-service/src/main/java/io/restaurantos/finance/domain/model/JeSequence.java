package io.restaurantos.finance.domain.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.UUID;

@Entity
@Table(name = "je_sequences")
@IdClass(JeSequenceId.class)
@Getter
@Setter
public class JeSequence implements Serializable {

    @Id
    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Id
    @Column(name = "fiscal_year", nullable = false)
    private int fiscalYear;

    @Column(name = "last_seq", nullable = false)
    private int lastSeq = 0;
}
