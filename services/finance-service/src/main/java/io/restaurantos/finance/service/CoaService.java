package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.dto.AccountDto;
import io.restaurantos.finance.dto.CreateAccountRequest;
import io.restaurantos.finance.dto.FinanceSetupStatusDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

public interface CoaService {

    int seedForTenant(UUID tenantId);

    Page<AccountDto> listAccounts(AccountType type, Boolean active, Pageable pageable);

    AccountDto getAccountByCode(String code);

    AccountDto createCustomAccount(CreateAccountRequest req);

    AccountDto getAccountBySystemTag(String tag);

    Page<AccountDto> searchActiveAccounts(String query, Pageable pageable);

    FinanceSetupStatusDto getSetupStatus();
}
