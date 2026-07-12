package io.restaurantos.kitchen.domain.model;

import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "kds_tickets")
@Getter
@Setter
public class KdsTicket extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "order_id", nullable = false)
    private UUID orderId;

    @Column(name = "order_no", length = 50)
    private String orderNo;

    @Column(name = "order_notes", length = 500)
    private String orderNotes;

    @Column(name = "table_number", length = 50)
    private String tableNumber;

    @Column(name = "station_code", nullable = false, length = 50)
    private String stationCode;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private TicketStatus status = TicketStatus.PENDING;

    @Column(name = "priority", nullable = false)
    private boolean priority = false;

    @Column(name = "received_at", nullable = false)
    private Instant receivedAt = Instant.now();

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "ready_at")
    private Instant readyAt;

    @OneToMany(mappedBy = "ticket", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<KdsTicketItem> items = new ArrayList<>();
}
