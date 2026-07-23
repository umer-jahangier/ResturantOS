package io.restaurantos.finance.autopost;

import io.restaurantos.finance.repository.ChartOfAccountRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class AccountResolver {

    private final ChartOfAccountRepository coaRepo;
    private final TenantContext tenantContext;

    public AccountResolver(ChartOfAccountRepository coaRepo, TenantContext tenantContext) {
        this.coaRepo = coaRepo;
        this.tenantContext = tenantContext;
    }

    public String codeBySystemTag(String systemTag) {
        UUID tenantId = tenantContext.requireTenantId();
        return coaRepo.findBySystemTag(systemTag).stream()
                .filter(a -> tenantId.equals(a.getTenantId()) && a.isActive())
                .map(a -> a.getCode())
                .findFirst()
                .orElseThrow(() -> new AccountNotConfiguredException(systemTag));
    }

    public String codeByAccountCode(String accountCode) {
        UUID tenantId = tenantContext.requireTenantId();
        return coaRepo.findByTenantIdAndCode(tenantId, accountCode)
                .filter(a -> a.isActive())
                .map(a -> a.getCode())
                .orElseThrow(() -> new AccountNotConfiguredException("Account not found", accountCode));
    }
}
