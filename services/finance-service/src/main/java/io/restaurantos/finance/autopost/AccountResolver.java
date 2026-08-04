package io.restaurantos.finance.autopost;

import io.restaurantos.finance.domain.model.ChartOfAccount;
import io.restaurantos.finance.repository.ChartOfAccountRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Resolves the account code an auto-posting recipe should use, from a stable {@code system_tag}
 * rather than a hardcoded number.
 *
 * <p><b>Ambiguity is an error, not a coin toss.</b> {@code findBySystemTag} returns a list and the
 * previous implementation took {@code findFirst()} on it. When 1300 "Inventory" and 1310 "Raw
 * Materials" both carried the tag {@code INVENTORY}, which account a COGS or transfer entry
 * credited depended on Postgres row order — a posting that changed between runs with nothing in
 * the logs. V8 de-duplicates the seeded tags and adds a partial unique index so this cannot
 * recur, and this class now refuses to guess if it ever does (a hand-edited chart, a restored
 * dump predating V8).
 */
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
        List<ChartOfAccount> matches = coaRepo.findBySystemTag(systemTag).stream()
                .filter(a -> tenantId.equals(a.getTenantId()) && a.isActive())
                .toList();

        if (matches.isEmpty()) {
            throw new AccountNotConfiguredException(systemTag);
        }
        if (matches.size() > 1) {
            throw AccountNotConfiguredException.ambiguous(
                    systemTag, matches.stream().map(ChartOfAccount::getCode).sorted().toList());
        }
        return matches.get(0).getCode();
    }

    public String codeByAccountCode(String accountCode) {
        UUID tenantId = tenantContext.requireTenantId();
        return coaRepo.findByTenantIdAndCode(tenantId, accountCode)
                .filter(ChartOfAccount::isActive)
                .map(ChartOfAccount::getCode)
                .orElseThrow(() -> new AccountNotConfiguredException("Account not found", accountCode));
    }
}
