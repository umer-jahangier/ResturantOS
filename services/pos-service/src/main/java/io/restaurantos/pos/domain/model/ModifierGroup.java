package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "modifier_groups")
@Getter
@Setter
public class ModifierGroup extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "menu_item_id", nullable = false)
    private MenuItem menuItem;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    /**
     * FORCED, in the cashier's words: this group must be answered before the line can be added.
     *
     * <p>It is the same fact as {@code minSelect >= 1} and the two are held in agreement by a
     * CHECK constraint (V25) as well as by the service, because two columns that can contradict
     * each other are two answers and the validator has to pick one.
     */
    @Column(name = "required", nullable = false)
    private boolean required = false;

    @Column(name = "min_select", nullable = false)
    private int minSelect = 0;

    @Column(name = "max_select", nullable = false)
    private int maxSelect = 1;

    /** The order the cashier sees the groups in on the configure dialog. */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    /**
     * Retiring, not deleting. A group rung on ten thousand historical checks must stay readable —
     * every order line snapshots the modifier's name and price anyway, but the catalogue row is
     * what a report joins back to. Inactive groups are hidden from the till and shown, greyed, to
     * whoever manages the menu.
     */
    @Column(name = "active", nullable = false)
    private boolean active = true;

    @OneToMany(mappedBy = "modifierGroup", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC, name ASC")
    private List<Modifier> modifiers = new ArrayList<>();
}
