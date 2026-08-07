package io.restaurantos.auth.service;

import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.payload.UserLifecycleEventContract;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static io.restaurantos.shared.event.payload.UserLifecycleEventContract.*;

/**
 * Publishes the user-lifecycle and privilege events (15-01).
 *
 * <h2>The gap this closes</h2>
 *
 * <p>Before this class, creating a user, granting them a role, revoking it and deactivating the
 * account produced <b>no event anywhere in the platform</b>. Those are the highest-privilege
 * operations the product exposes to a tenant, and the only record of them was the mutated row —
 * which states the present and says nothing about who changed it or when. "Who gave this cashier
 * refund authority, and when" had no answer. Meanwhile {@code RBAC_CHANGED} sat in audit-service's
 * allow-list, published by nothing, so the pipeline looked configured for exactly this and was not.
 *
 * <h2>Every publish is inside the caller's write transaction</h2>
 *
 * <p>{@code DomainEventPublisher} INSERTs into {@code event_outbox}, and these methods are called
 * from inside the {@code @Transactional} methods of {@link UserLifecycleService} and
 * {@link BranchRoleAdminService}. So the row change and its event commit together or neither does.
 * That is the property that makes the trail trustworthy rather than merely present: there is no
 * interleaving in which a role is granted and the event is lost, or in which an event records a
 * grant that was rolled back.
 *
 * <p>It is also why these events are published here and not from user-service, where the tenant
 * admin's request actually arrives. user-service owns none of this data and every one of its writes
 * is a Feign delegation to this service; publishing there would mean publishing after a remote call
 * had already committed, with no transaction to bind the two. See {@link UserLifecycleEventContract}.
 *
 * <h2>No credential ever reaches a payload</h2>
 *
 * <p>Creation generates a temporary password. It is returned to the calling administrator in the
 * HTTP response and it exists nowhere else — not here, not in {@code event_outbox}, not in
 * {@code audit_events}. The payload records have no field it could occupy and
 * {@code UserLifecycleEventPayloadTest} asserts that reflectively, so a future field named
 * {@code password} or {@code token} fails the build rather than quietly writing a credential into
 * a plain-text table that is replicated, brokered and retained for seven years.
 */
@Service
public class UserLifecycleEventPublisher {

    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public UserLifecycleEventPublisher(EventPublisher eventPublisher, TenantContext tenantContext) {
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    public void userCreated(UUID tenantId, UUID actingUserId, UUID targetUserId, String targetEmail,
                            String initialRole, UUID initialBranchId) {
        ensureContext(tenantId, actingUserId);
        eventPublisher.publish(EXCHANGE, USER_CREATED_KEY, USER_CREATED, initialBranchId,
            new UserCreatedPayload(targetUserId, targetEmail, actingUserId,
                initialRole, initialBranchId, Instant.now()));
    }

    public void userUpdated(UUID tenantId, UUID actingUserId, UUID targetUserId, String targetEmail,
                            List<String> changedFields) {
        // A patch that changed nothing is not an audit event. Recording it would fill the trail
        // with rows that say a field was edited to the value it already had, which is noise in the
        // one table where noise is expensive: it is append-only and kept for seven years.
        if (changedFields == null || changedFields.isEmpty()) {
            return;
        }
        ensureContext(tenantId, actingUserId);
        eventPublisher.publish(EXCHANGE, USER_UPDATED_KEY, USER_UPDATED, null,
            new UserUpdatedPayload(targetUserId, targetEmail, actingUserId,
                List.copyOf(changedFields), Instant.now()));
    }

    /**
     * Deactivation and reactivation. {@code active} selects the event type, so a query can filter
     * on the action column without reading payloads.
     */
    public void activationChanged(UUID tenantId, UUID actingUserId, UUID targetUserId,
                                  String targetEmail, boolean active, int sessionsRevoked) {
        ensureContext(tenantId, actingUserId);
        eventPublisher.publish(EXCHANGE,
            active ? USER_REACTIVATED_KEY : USER_DEACTIVATED_KEY,
            active ? USER_REACTIVATED : USER_DEACTIVATED,
            null,
            new UserActivationChangedPayload(targetUserId, targetEmail, actingUserId,
                active, sessionsRevoked, Instant.now()));
    }

    public void roleGranted(UUID tenantId, UUID actingUserId, UUID targetUserId, UUID branchId,
                            String roleCode, String displacedRoleCode, Long approvalLimitPaisa,
                            boolean primary) {
        ensureContext(tenantId, actingUserId);
        eventPublisher.publish(EXCHANGE, ROLE_GRANTED_KEY, ROLE_GRANTED, branchId,
            new RoleGrantedPayload(targetUserId, actingUserId, branchId, roleCode,
                displacedRoleCode, approvalLimitPaisa, primary, Instant.now()));
    }

    public void roleRevoked(UUID tenantId, UUID actingUserId, UUID targetUserId, UUID branchId,
                            String roleCode) {
        ensureContext(tenantId, actingUserId);
        eventPublisher.publish(EXCHANGE, ROLE_REVOKED_KEY, ROLE_REVOKED, branchId,
            new RoleRevokedPayload(targetUserId, actingUserId, branchId, roleCode, Instant.now()));
    }

    /**
     * Make sure the publisher can see a tenant and an actor.
     *
     * <p>{@code DomainEventPublisher} reads the tenant and the actor from {@link TenantContext},
     * which {@code JwtAuthenticationFilter} populates on a normal request. Two callers here are not
     * normal requests: {@code /internal/auth/**} arrives with the tenant and acting user as headers
     * rather than a token, and {@code ProvisioningAdminService} runs in system context with no
     * request at all. Both would otherwise publish an event with a null actor — the very defect the
     * envelope's {@code actorId} was added to fix.
     *
     * <p>This only ever FILLS IN a missing value. An already-populated context is left alone,
     * including its {@code impersonatedBy}, which must survive to the event: an action taken by a
     * platform administrator wearing a tenant user's identity has to record the real human, and
     * overwriting the snapshot here would erase exactly that.
     */
    private void ensureContext(UUID tenantId, UUID actingUserId) {
        if (tenantContext.getTenantId().isPresent() && tenantContext.getUserId().isPresent()) {
            return;
        }
        tenantContext.set(
            tenantContext.getTenantId().orElse(tenantId),
            tenantContext.getBranchId().orElse(null),
            tenantContext.getUserId().orElse(actingUserId),
            tenantContext.getImpersonatedBy().orElse(null));
    }
}
