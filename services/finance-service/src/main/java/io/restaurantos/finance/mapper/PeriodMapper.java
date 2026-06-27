package io.restaurantos.finance.mapper;

import io.restaurantos.finance.domain.model.AccountingPeriod;
import io.restaurantos.finance.dto.AccountingPeriodDto;
import org.springframework.stereotype.Component;

@Component
public class PeriodMapper {

    public AccountingPeriodDto toDto(AccountingPeriod p) {
        return new AccountingPeriodDto(
                p.getId(),
                p.getFiscalYear(),
                p.getPeriodNo(),
                p.getStartDate(),
                p.getEndDate(),
                p.getStatus(),
                p.getLockedBy(),
                p.getLockedAt()
        );
    }
}
