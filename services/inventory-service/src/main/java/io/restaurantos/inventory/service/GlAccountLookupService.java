package io.restaurantos.inventory.service;

import io.restaurantos.inventory.exception.FinanceUnavailableException;
import io.restaurantos.inventory.feign.FinanceCoaClient;
import io.restaurantos.inventory.feign.GlAccountDto;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Inventory's narrow window onto finance-service's chart of accounts.
 *
 * <p>Everything inventory needs to do with GL accounts goes through here: the category form's
 * picker, and the write-time validation behind it. Both are scoped to a {@link GlAccountUsage}, so
 * an inventory user only ever sees active accounts of the types their current field accepts —
 * never the whole chart. That is the entire reason this indirection exists instead of granting
 * inventory users {@code finance.coa.view}: filling in three fields should not hand over the
 * finance module's read surface.
 *
 * <p>Every call fails CLOSED. See {@link FinanceUnavailableException} for why a fallback would be
 * actively harmful on the write path.
 */
@Service
public class GlAccountLookupService {

    private static final Logger log = LoggerFactory.getLogger(GlAccountLookupService.class);
    private static final int MAX_RESULTS = 20;

    private final FinanceCoaClient financeCoaClient;
    private final TenantContext tenantContext;

    public GlAccountLookupService(FinanceCoaClient financeCoaClient, TenantContext tenantContext) {
        this.financeCoaClient = financeCoaClient;
        this.tenantContext = tenantContext;
    }

    /**
     * Type-narrowed account search for the picker. A blank query is legitimate — it is what the
     * dropdown sends when it first opens, before the user has typed anything.
     */
    public List<GlAccountDto> search(GlAccountUsage usage, String query) {
        UUID tenantId = tenantContext.requireTenantId();
        ApiResponse<List<GlAccountDto>> response = call(
                () -> financeCoaClient.searchAccounts(
                        tenantId, query == null ? "" : query.trim(), usage.accountTypes(), MAX_RESULTS),
                "search accounts");
        return response == null || response.data() == null ? List.of() : response.data();
    }

    /**
     * Resolves account CODES, returning only those that exist for the tenant. Used when reading
     * legacy category rows whose account id was never backfilled (the code did not resolve at
     * migration time) and when validating a request that still supplies codes.
     */
    public Map<String, GlAccountDto> resolveByCodes(Collection<String> codes) {
        Set<String> distinct = distinct(codes);
        if (distinct.isEmpty()) {
            return Map.of();
        }
        UUID tenantId = tenantContext.requireTenantId();
        ApiResponse<Map<String, GlAccountDto>> response = call(
                () -> financeCoaClient.resolveByCodes(tenantId, List.copyOf(distinct)), "resolve account codes");
        return response == null || response.data() == null ? Map.of() : response.data();
    }

    /** Resolves account IDS — the form the category table stores since V8. */
    public Map<UUID, GlAccountDto> resolveByIds(Collection<UUID> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        Set<UUID> distinct = new LinkedHashSet<>(ids);
        distinct.remove(null);
        if (distinct.isEmpty()) {
            return Map.of();
        }
        UUID tenantId = tenantContext.requireTenantId();
        ApiResponse<Map<UUID, GlAccountDto>> response = call(
                () -> financeCoaClient.resolveByIds(tenantId, List.copyOf(distinct)), "resolve account ids");
        return response == null || response.data() == null ? Map.of() : response.data();
    }

    private static Set<String> distinct(Collection<String> codes) {
        Set<String> distinct = new LinkedHashSet<>();
        if (codes != null) {
            for (String code : codes) {
                if (code != null && !code.isBlank()) {
                    distinct.add(code.trim());
                }
            }
        }
        return distinct;
    }

    /**
     * One place where a transport failure becomes a domain failure, so no caller can accidentally
     * swallow it into an empty result and treat that as "no such account".
     */
    private <T> T call(Supplier<T> remoteCall, String what) {
        try {
            return remoteCall.get();
        } catch (RuntimeException ex) {
            log.warn("finance-service call failed while trying to {}", what, ex);
            throw new FinanceUnavailableException(ex);
        }
    }
}
