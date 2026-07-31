package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.dto.AccountDto;
import io.restaurantos.finance.dto.CreateAccountRequest;
import io.restaurantos.finance.dto.FinanceSetupStatusDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

public interface CoaService {

    int seedForTenant(UUID tenantId);

    Page<AccountDto> listAccounts(AccountType type, Boolean active, Pageable pageable);

    AccountDto getAccountByCode(String code);

    AccountDto createCustomAccount(CreateAccountRequest req);

    AccountDto getAccountBySystemTag(String tag);

    Page<AccountDto> searchActiveAccounts(String query, Pageable pageable);

    /**
     * Tenant-explicit, type-narrowed search backing the cross-service account-picker seam
     * ({@code GET /internal/finance/accounts/search}). Unlike {@link #searchActiveAccounts} the
     * tenant is supplied by the caller rather than read off an ambient context, because internal
     * callers have no user principal of their own.
     */
    Page<AccountDto> searchActiveAccountsForTenant(UUID tenantId, String query,
                                                    Collection<AccountType> types, Pageable pageable);

    /**
     * Batch code → account resolution for other services' write-time validation. Codes that do not
     * resolve are simply absent from the result, letting the caller report precisely which of its
     * own fields was wrong.
     */
    Map<String, AccountDto> resolveByCodes(UUID tenantId, Collection<String> codes);

    /** Batch id → account resolution, for callers that store an account's immutable id. */
    Map<UUID, AccountDto> resolveByIds(UUID tenantId, Collection<UUID> ids);

    FinanceSetupStatusDto getSetupStatus();
}
