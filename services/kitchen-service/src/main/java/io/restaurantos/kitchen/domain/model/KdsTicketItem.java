package io.restaurantos.kitchen.domain.model;

import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "kds_ticket_items")
@Getter
@Setter
public class KdsTicketItem extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ticket_id", nullable = false)
    private KdsTicket ticket;

    @Column(name = "order_item_id", nullable = false)
    private UUID orderItemId;

    @Column(name = "name", nullable = false, length = 200)
    private String name;

    @Column(name = "qty", nullable = false)
    private int qty;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "modifiers", columnDefinition = "jsonb")
    private List<String> modifiers;

    @Column(name = "notes")
    private String notes;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private TicketItemStatus status = TicketItemStatus.PENDING;
}
