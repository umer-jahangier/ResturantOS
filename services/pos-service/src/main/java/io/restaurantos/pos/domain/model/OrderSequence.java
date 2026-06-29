package io.restaurantos.pos.domain.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "order_sequences")
@IdClass(OrderSequenceId.class)
@Getter
@Setter
public class OrderSequence implements Serializable {

    @Id
    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Id
    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Id
    @Column(name = "business_date", nullable = false)
    private LocalDate businessDate;

    @Column(name = "last_seq", nullable = false)
    private int lastSeq = 0;
}
