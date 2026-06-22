package io.restaurantos.shared.tenant;

import java.util.Optional;
import java.util.UUID;

public class ThreadLocalTenantContext implements TenantContext {

    private static final ThreadLocal<TenantSnapshot> HOLDER = new ThreadLocal<>();

    @Override public Optional<UUID> getTenantId() {
        TenantSnapshot s = HOLDER.get();
        return s == null ? Optional.empty() : Optional.ofNullable(s.tenantId());
    }
    @Override public UUID requireTenantId() {
        return getTenantId().orElseThrow(() ->
            new IllegalStateException("TenantContext is empty: tenant id was not set on this thread"));
    }
    @Override public Optional<UUID> getBranchId() {
        TenantSnapshot s = HOLDER.get();
        return s == null ? Optional.empty() : Optional.ofNullable(s.branchId());
    }
    @Override public Optional<UUID> getUserId() {
        TenantSnapshot s = HOLDER.get();
        return s == null ? Optional.empty() : Optional.ofNullable(s.userId());
    }
    @Override public Optional<UUID> getImpersonatedBy() {
        TenantSnapshot s = HOLDER.get();
        return s == null ? Optional.empty() : Optional.ofNullable(s.impersonatedBy());
    }
    @Override public void set(UUID tenantId, UUID branchId, UUID userId, UUID impersonatedBy) {
        HOLDER.set(new TenantSnapshot(tenantId, branchId, userId, impersonatedBy));
    }
    @Override public TenantSnapshot snapshot() { return HOLDER.get(); }
    @Override public void restore(TenantSnapshot snapshot) { if (snapshot != null) HOLDER.set(snapshot); }
    @Override public void clear() { HOLDER.remove(); }
}
