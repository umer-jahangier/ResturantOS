package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.TaxBase;
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

import java.util.UUID;

/**
 * One tenant's sales-tax base position (V27).
 *
 * <p>Tenant-scoped, not branch-scoped, unlike {@link BranchServiceCharge} — and the split is the
 * same one V24 drew in the other direction. A service charge is a commercial decision about one
 * dining room, so a rooftop and a takeaway counter in the same tenant may differ. Whether a
 * discount reduces the value of supply is a statutory fact about the business and cannot differ
 * between two dining rooms, which is why this sits beside {@link TaxClass} rather than beside the
 * service charge.
 *
 * <p><b>A tenant with no row is {@link TaxBase#NET}.</b> That is not a fallback papering over a
 * failed read — it is the answer. Every tenant upgrading into V27 has no row and must price
 * correctly without anyone visiting a screen, exactly as a branch nobody has configured takes no
 * service charge. {@code TaxPolicyService.policyFor} returns an {@code Optional} and empty means
 * NET.
 */
@Entity
@Table(name = "tenant_tax_policy")
@Getter
@Setter
public class TenantTaxPolicy extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /**
     * NET or GROSS.
     *
     * <p>{@code EnumType.STRING} for the reason every enum in this codebase is mapped that way:
     * an ordinal would silently re-point every existing row at a different meaning the day
     * somebody reorders the constants, and the rows this column governs decide what is remitted.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "tax_base", nullable = false, length = 10)
    private TaxBase taxBase = TaxBase.NET;
}
