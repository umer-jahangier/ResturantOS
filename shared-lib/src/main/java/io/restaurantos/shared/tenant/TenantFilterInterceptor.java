package io.restaurantos.shared.tenant;

import jakarta.persistence.EntityManager;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hibernate.Session;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.UUID;

/**
 * HTTP path: enables the Hibernate tenantFilter after JwtAuthenticationFilter has
 * populated TenantContext. PostgreSQL RLS GUC is applied by {@link TenantAwareDataSource}
 * at JDBC connection checkout (same connection as {@code @Transactional} work).
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
        return true;
    }
}
