package io.restaurantos.nlq.settings;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * <p>Every lookup is {@code findByTenantId} with an EXPLICIT predicate, never a bare
 * {@code findAll()} leaning on RLS to do the scoping.
 *
 * <p>That is not belt-and-braces for its own sake. If {@code app.current_tenant_id} were ever
 * unset on a checked-out connection — and this codebase has open findings for exactly that
 * (stale/empty GUCs, an inert tenant interceptor) — an RLS-only read returns ZERO ROWS rather
 * than erroring. Zero rows here means "this tenant has no key", which means the resolver silently
 * falls back to the platform key and bills the platform for a tenant who opted out. A silent
 * billing leak that no test would notice.
 *
 * <p>With an explicit predicate the query is correct regardless of the GUC, and RLS remains as the
 * second line it is supposed to be.
 */
public interface TenantAiSettingsRepository extends JpaRepository<TenantAiSettingsEntity, UUID> {

    Optional<TenantAiSettingsEntity> findByTenantId(UUID tenantId);
}
