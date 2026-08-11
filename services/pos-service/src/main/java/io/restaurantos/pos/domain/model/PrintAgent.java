package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A machine that prints. See {@code V17__print_agents.sql} for why this table exists and why the
 * credential is not in {@code receipt_config}.
 *
 * <p>This is deliberately NOT a user. It has no roles, no permissions and no principal identity in
 * the authorisation model. It resolves to a branch, and that is the entire extent of what holding
 * its credential lets you do. A credential minted for one purpose growing into an unaudited
 * authority is this codebase's signature defect; the shape of this entity is the guard against
 * repeating it.
 */
@Entity
@Table(name = "print_agents")
@Getter
@Setter
public class PrintAgent extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** The one branch this agent may claim work for. */
    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "label", nullable = false, length = 120)
    private String label;

    /**
     * The non-secret half of the credential string. Authenticates nothing on its own — it exists
     * because bcrypt hashes are salted and a credential therefore cannot be found by its hash.
     */
    @Column(name = "lookup_id", nullable = false, length = 32)
    private String lookupId;

    /** bcrypt at cost 12, the same encoder auth-service uses. Never returned by any read. */
    @Column(name = "credential_hash", nullable = false, length = 120)
    private String credentialHash;

    /** Set on revoke; the row survives so an operator can see it existed and when it stopped. */
    @Column(name = "revoked_at")
    private Instant revokedAt;

    /** Last successful claim poll. An agent that has never polled must not look like a working one. */
    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

    public boolean isRevoked() {
        return revokedAt != null;
    }
}
