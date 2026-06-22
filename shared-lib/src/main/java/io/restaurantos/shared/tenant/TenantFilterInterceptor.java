package io.restaurantos.shared.tenant;

import jakarta.persistence.EntityManager;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hibernate.Session;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.UUID;

/**
 * HTTP path: enables the Hibernate tenantFilter and sets app.current_tenant_id for RLS
 * after JwtAuthenticationFilter has populated TenantContext.
 * Registered for all controllers by SharedAutoConfiguration / WebMvcSharedConfig.
 */
public class TenantFilterInterceptor implements HandlerInterceptor {

    private final EntityManager entityManager;
    private final TenantContext tenantContext;

    public TenantFilterInterceptor(EntityManager entityManager, TenantContext tenantContext) {
        this.entityManager = entityManager;
        this.tenantContext = tenantContext;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (tenantContext.getTenantId().isEmpty()) return true; // platform/public endpoints
        UUID tenantId = tenantContext.requireTenantId();
        Session session = entityManager.unwrap(Session.class);
        session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
        return true;
    }
}
