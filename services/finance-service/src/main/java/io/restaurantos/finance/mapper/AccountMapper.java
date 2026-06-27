package io.restaurantos.finance.mapper;

import io.restaurantos.finance.domain.model.ChartOfAccount;
import io.restaurantos.finance.dto.AccountDto;
import org.springframework.stereotype.Component;

@Component
public class AccountMapper {

    public AccountDto toDto(ChartOfAccount coa) {
        if (coa == null) return null;
        return new AccountDto(
                coa.getId(),
                coa.getCode(),
                coa.getName(),
                coa.getAccountType(),
                coa.getParentCode(),
                coa.isSystem(),
                coa.getSystemTag(),
                coa.isActive()
        );
    }
}
