package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * One menu category a terminal OFFERS (D-28-03).
 *
 * <p><b>No rows for a terminal means it offers every category.</b> Not "none" — every. That is the
 * only encoding under which a tenant who never opens the terminals screen keeps today's behaviour,
 * and today's behaviour is one POS showing the whole menu. Do not add a {@code servesAll} flag to
 * make the default look more explicit; a flag and the rows it summarises can disagree.
 *
 * <p><b>This is a menu FILTER, not an authorization boundary.</b> Nothing reads these rows to
 * refuse an add-item. The POS uses them to decide what to draw. Saying so matters: an ambiguous
 * half-enforcement is the shape of the guard phase 13-16 found in {@code createOrder}, which only
 * fired when a user id happened to be present and therefore established nothing it appeared to.
 */
@Entity
@Table(name = "pos_terminal_categories")
@Getter
@Setter
public class PosTerminalCategory extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "terminal_id", nullable = false)
    private UUID terminalId;

    @Column(name = "category_id", nullable = false)
    private UUID categoryId;
}
