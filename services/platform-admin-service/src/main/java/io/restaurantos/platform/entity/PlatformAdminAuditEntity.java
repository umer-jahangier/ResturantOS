package io.restaurantos.platform.entity;

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

import java.time.Instant;
import java.util.UUID;

/**
 * One platform-operator action on a tenant's user (superadmin plan) — the control plane's own
 * accountability trail, beside {@link ImpersonationLogEntity}.
 *
 * <p>Append-only in the database by trigger, not by grant (changeset 050; see
 * {@code 040-platform-db-rls-posture.xml} for why a REVOKE here is inert on this cluster). Nothing
 * in this service updates or deletes a row: {@link io.restaurantos.platform.service
 * .PlatformAdminAuditRecorder} calls {@code save} on a fresh entity and there is no other write
 * path. NO RLS, deliberately — 040 is the decision record.
 *
 * <p><b>Why the trail lives in platform_db rather than audit_db.</b> {@code audit_events.tenant_id}
 * is NOT NULL and its actor columns are read as {@code auth_db.users} ids by every consumer, so a
 * {@code platform_users} id written there names somebody who does not exist in that tenant. Beyond
 * that, {@code platform_db} cannot reach {@code audit_db} at all — separate databases, no FDW, no
 * dblink, zero cross-grants — and every audit partition is FORCE RLS on a GUC the platform plane
 * cannot populate. See changeset 050's header for the measurements.
 *
 * <p><b>No credential, ever.</b> The platform password reset returns a temporary password to the
 * operator and it exists nowhere else. {@link #detail} is plain text in a table nothing purges, so
 * it records what happened and never what was issued — the same rule
 * {@code idempotency_keys.response_json} taught this service the hard way (13-10).
 */
@Entity
@Table(name = "platform_admin_audit")
@Getter
@Setter
public class PlatformAdminAuditEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt = Instant.now();

    /**
     * The acting {@code platform_users.id}, from the {@code sub} of an RS256-verified control-plane
     * token. Never a body field, never a header — see {@code PlatformUserAdminController}.
     */
    @Column(name = "platform_user_id", nullable = false, updatable = false)
    private UUID platformUserId;

    /**
     * Denormalised at write time. The id is authoritative; the address is what a review reads the
     * row by, and resolving it later against a table whose rows may since have been rotated
     * (changeset 910 replaces the seeded SuperAdmin) produces a trail that changes its own history.
     */
    @Column(name = "platform_user_email", updatable = false)
    private String platformUserEmail;

    @Column(nullable = false, length = 60, updatable = false)
    @Enumerated(EnumType.STRING)
    private PlatformAdminAction action;

    /** Nullable: not every platform action is tenant-scoped, and a synthetic id would be a lie. */
    @Column(name = "tenant_id", updatable = false)
    private UUID tenantId;

    @Column(name = "target_user_id", updatable = false)
    private UUID targetUserId;

    @Column(length = 500, updatable = false)
    private String reason;

    @Column(nullable = false, length = 20, updatable = false)
    @Enumerated(EnumType.STRING)
    private Outcome outcome;

    @Column(length = 1000, updatable = false)
    private String detail;

    /**
     * What the platform tier may do to a tenant's user, enumerated.
     *
     * <p>Mirrored by a CHECK constraint in changeset 050 rather than trusted to this enum alone: a
     * renamed constant then fails the INSERT loudly instead of writing rows no query filters on,
     * which is the drift class this repository has hit repeatedly over permission codes. Adding an
     * action means a changeset — the intended amount of friction for widening what a SuperAdmin
     * may do.
     *
     * <p><b>There is deliberately no role-grant action here</b>, because there is no role-grant
     * capability. 13-02 split {@code rbac.manage} so a tenant admin could not mint an OWNER, and
     * the platform tier holds no {@code user_branch_roles} to be bounded by — so its RBAC surface
     * is read-only. See {@code RbacCatalogInternalService} in auth-service.
     */
    public enum PlatformAdminAction {
        USER_PASSWORD_RESET,
        USER_DEACTIVATED,
        USER_REACTIVATED,
        USER_UNLOCKED,
        USER_SESSIONS_REVOKED
    }

    /**
     * Whether the action took effect.
     *
     * <p>{@code REFUSED} rows are written too, and that is the point rather than an afterthought: an
     * operator repeatedly attempting something they are refused is exactly the pattern an abuse
     * review looks for, and a trail that records only successes cannot show it. The refusal reason
     * goes in {@link #detail}.
     */
    public enum Outcome {
        SUCCEEDED,
        REFUSED
    }
}
