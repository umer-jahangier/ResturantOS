package io.restaurantos.shared.tenant;

import org.springframework.core.task.TaskDecorator;

/** Propagates TenantContext into @Async worker threads (resolves CRIT-01 async half). */
public class TenantTaskDecorator implements TaskDecorator {
    private final TenantContext tenantContext;
    public TenantTaskDecorator(TenantContext tenantContext) { this.tenantContext = tenantContext; }

    @Override
    public Runnable decorate(Runnable runnable) {
        TenantContext.TenantSnapshot snapshot = tenantContext.snapshot();
        return () -> {
            try { tenantContext.restore(snapshot); runnable.run(); }
            finally { tenantContext.clear(); }
        };
    }
}
