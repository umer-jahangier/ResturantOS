package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.enums.TaxBase;
import io.restaurantos.pos.domain.model.TenantTaxPolicy;
import io.restaurantos.pos.dto.TaxPolicyDtos.TaxPolicyDto;
import io.restaurantos.pos.dto.TaxPolicyDtos.UpdateTaxPolicyRequest;
import io.restaurantos.pos.repository.TenantTaxPolicyRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@Transactional(readOnly = true)
public class TaxPolicyServiceImpl implements TaxPolicyService {

    private final TenantTaxPolicyRepository repository;
    private final TenantContext tenantContext;
    private final PosAuthorizationService authorization;

    public TaxPolicyServiceImpl(TenantTaxPolicyRepository repository,
                                TenantContext tenantContext,
                                PosAuthorizationService authorization) {
        this.repository = repository;
        this.tenantContext = tenantContext;
        this.authorization = authorization;
    }

    /**
     * Read is gated on {@code pos.menu.view}, not on the manage code, and it never 404s.
     *
     * <p>Same split, same reason, as {@code ServiceChargeServiceImpl.get}. A MANAGER can read the
     * position and not change it. When a guest disputes the tax on a discounted bill it is the
     * manager standing there, and being unable to look up which base the check was priced on
     * leaves them defending a number the product hides from them.
     */
    @Override
    public TaxPolicyDto get() {
        authorization.requireMenuView();
        UUID tenantId = tenantContext.requireTenantId();
        boolean canManage = authorization.hasPermission("pos.tax.manage");
        return repository.findByTenantId(tenantId)
                .map(row -> new TaxPolicyDto(tenantId, row.getTaxBase(), true, canManage))
                // Unconfigured. NET, and `configured = false` so a caller can tell "nobody has
                // decided, and the default applies" from "somebody decided NET" — the same
                // arithmetic, and a very different answer to an auditor asking who chose it.
                .orElseGet(() -> new TaxPolicyDto(tenantId, TaxBase.NET, false, canManage));
    }

    /**
     * <h2>Changing the base does NOT re-price anything already settled</h2>
     *
     * <p>Nothing here touches an order. A settled check keeps the tax it was closed at forever —
     * {@code order_items.tax_base} snapshots which rule priced each line, for the same reason
     * {@code tax_rate_pct} snapshots the rate — and the rows reporting-service has already written
     * to {@code sales_order_facts}, which {@code FbrTaxSummaryService} sums into output tax on a
     * return, do not move.
     *
     * <p>An OPEN check re-bases the next time anything on it changes, which is the same behaviour
     * {@code ServiceChargeServiceImpl.update} documents for a rate change and correct for the same
     * reason: an open check has not been presented to a guest yet.
     *
     * <p>Gated on {@code pos.tax.manage} rather than a code of its own. Changesets 091 and 093
     * established that verbs sharing a noun and nothing else do not share a permission — but this
     * is not a different verb. Deciding that standard rate MEANS 17% and deciding what that 17% is
     * a percentage OF are the same decision class by every test 091 applied: both are statutory
     * positions about the business, both are wrong for every check at once when they are wrong,
     * and both mis-state the return rather than one bill. Splitting here would be splitting
     * against the merits, and it would ship a setting no role held on the day it went out.
     */
    @Override
    @Transactional
    public TaxPolicyDto update(UpdateTaxPolicyRequest request) {
        authorization.requireTaxManage();
        UUID tenantId = tenantContext.requireTenantId();

        TenantTaxPolicy row = repository.findByTenantId(tenantId)
                .orElseGet(() -> {
                    TenantTaxPolicy fresh = new TenantTaxPolicy();
                    fresh.setTenantId(tenantId);
                    return fresh;
                });
        row.setTaxBase(request.taxBase());

        return new TaxPolicyDto(tenantId, repository.save(row).getTaxBase(), true, true);
    }

    @Override
    public TaxBase taxBaseForCurrentTenant() {
        return repository.findByTenantId(tenantContext.requireTenantId())
                .map(TenantTaxPolicy::getTaxBase)
                .orElse(TaxBase.NET);
    }
}
