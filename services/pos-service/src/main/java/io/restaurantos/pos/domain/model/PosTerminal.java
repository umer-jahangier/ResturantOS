package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * A named POS terminal profile — the thing the user asked for by name (D-28-03):
 * <em>"a dedicated POS which should be selecting respective menu"</em>.
 *
 * <p>A terminal has a branch, an operator-facing code unique within that branch, a name, a service
 * model, an optional pre-selected order type and an optional opaque printer handle. What it OFFERS
 * (menu categories) and where it FIRES (stations) live in {@link PosTerminalCategory} and
 * {@link PosTerminalStation} respectively.
 *
 * <p><b>Empty scope means everything.</b> A terminal with no category rows offers the whole menu; a
 * terminal with no station rows fires to every station. There is no {@code servesAll} flag and none
 * may be added — a flag and the rows it summarises can disagree, and then one of them is wrong with
 * nothing to say which. This is also what makes the do-nothing configuration identical to today's
 * behaviour, which is one POS showing everything.
 *
 * <p><b>Deactivated, never deleted.</b> From plan 28-12 {@code orders.terminal_id} references these
 * rows and a closed order must keep naming the terminal it was taken on. Same posture as
 * {@code DiningTable} and {@link Station}.
 */
@Entity
@Table(name = "pos_terminals")
@Getter
@Setter
public class PosTerminal extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    /**
     * The operator-facing code, unique within the branch. Immutable after creation, like a
     * station's — a device remembers which terminal it is by this handle, and renaming the handle
     * would silently re-point every screen that stored it.
     */
    @Column(name = "code", nullable = false, length = 50)
    private String code;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "service_model", nullable = false, length = 20)
    private ServiceModel serviceModel = ServiceModel.DEFAULT;

    /** Pre-selected on this terminal; the operator can still change it. Null means no preference. */
    @Enumerated(EnumType.STRING)
    @Column(name = "default_order_type", length = 20)
    private OrderType defaultOrderType;

    /**
     * An opaque handle for the receipt printer, or null.
     *
     * <p>Deliberately a string and deliberately not parsed here. Thermal printing is owned by phase
     * 26 and it decides the identifier scheme; modelling an address or a model name in this entity
     * would either duplicate that decision or contradict it.
     */
    @Column(name = "printer_ref", length = 200)
    private String printerRef;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
