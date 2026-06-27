package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.domain.model.ChartOfAccount;
import io.restaurantos.finance.dto.AccountDto;
import io.restaurantos.finance.dto.CreateAccountRequest;
import io.restaurantos.finance.exception.AccountNotFoundException;
import io.restaurantos.finance.mapper.AccountMapper;
import io.restaurantos.finance.repository.ChartOfAccountRepository;
import io.restaurantos.finance.seed.PakistanRestaurantCoaTemplate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class CoaServiceImpl implements CoaService {

    private final ChartOfAccountRepository coaRepo;
    private final AccountMapper mapper;

    public CoaServiceImpl(ChartOfAccountRepository coaRepo, AccountMapper mapper) {
        this.coaRepo = coaRepo;
        this.mapper = mapper;
    }

    @Override
    public int seedForTenant(UUID tenantId) {
        List<ChartOfAccount> template = PakistanRestaurantCoaTemplate.build(tenantId);
        int count = 0;
        for (ChartOfAccount account : template) {
            if (!coaRepo.existsByCode(account.getCode())) {
                coaRepo.save(account);
                count++;
            }
        }
        return count;
    }

    @Override
    @Transactional(readOnly = true)
    public Page<AccountDto> listAccounts(AccountType type, Boolean active, Pageable pageable) {
        Page<ChartOfAccount> page;
        if (type != null && active != null) {
            page = coaRepo.findByAccountTypeAndActive(type, active, pageable);
        } else if (type != null) {
            page = coaRepo.findByAccountType(type, pageable);
        } else if (active != null) {
            page = coaRepo.findByActive(active, pageable);
        } else {
            page = coaRepo.findAll(pageable);
        }
        return page.map(mapper::toDto);
    }

    @Override
    @Transactional(readOnly = true)
    public AccountDto getAccountByCode(String code) {
        return coaRepo.findByCode(code)
                .map(mapper::toDto)
                .orElseThrow(() -> new AccountNotFoundException(code));
    }

    @Override
    public AccountDto createCustomAccount(CreateAccountRequest req) {
        ChartOfAccount account = new ChartOfAccount();
        account.setCode(req.code());
        account.setName(req.name());
        account.setAccountType(req.accountType());
        account.setParentCode(req.parentCode());
        account.setSystem(false);
        account.setActive(true);
        return mapper.toDto(coaRepo.save(account));
    }

    @Override
    @Transactional(readOnly = true)
    public AccountDto getAccountBySystemTag(String tag) {
        return coaRepo.findBySystemTag(tag).stream()
                .findFirst()
                .map(mapper::toDto)
                .orElseThrow(() -> new AccountNotFoundException("systemTag:" + tag));
    }
}
