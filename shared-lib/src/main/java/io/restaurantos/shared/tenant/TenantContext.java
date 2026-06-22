package io.restaurantos.shared.tenant;

import java.util.Optional;
import java.util.UUID;

/** Request/operation-scoped tenant identity, backed by a ThreadLocal. */
public interface TenantContext {

    Optional<UUID> getTenantId();
    UUID requireTenantId();
    Optional<UUID> getBranchId();
    Optional<UUID> getUserId();
    Optional<UUID> getImpersonatedBy();
    void set(UUID tenantId, UUID branchId, UUID userId, UUID impersonatedBy);
    TenantSnapshot snapshot();
    void restore(TenantSnapshot snapshot);
    /** MUST be called in a finally block to prevent ThreadLocal leaks. */
    void clear();

    record TenantSnapshot(UUID tenantId, UUID branchId, UUID userId, UUID impersonatedBy) {}
}
