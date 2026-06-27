package io.restaurantos.finance.service;

import io.restaurantos.finance.dto.GlBalanceDto;
import io.restaurantos.finance.dto.JournalLineDto;
import io.restaurantos.finance.mapper.JournalEntryMapper;
import io.restaurantos.finance.repository.JournalLineRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
public class GlService {

    private final JournalLineRepository lineRepo;
    private final JournalEntryMapper mapper;

    public GlService(JournalLineRepository lineRepo, JournalEntryMapper mapper) {
        this.lineRepo = lineRepo;
        this.mapper = mapper;
    }

    public List<GlBalanceDto> getGlBalances(UUID periodId) {
        List<Object[]> raw = lineRepo.findGlBalancesRaw(periodId);
        return raw.stream()
                .map(row -> {
                    String code = (String) row[0];
                    long dr = ((Number) row[1]).longValue();
                    long cr = ((Number) row[2]).longValue();
                    return new GlBalanceDto(code, dr, cr, dr - cr);
                })
                .toList();
    }

    public Page<JournalLineDto> getGlEntries(String accountCode, UUID periodId, Pageable pageable) {
        return lineRepo.findPostedByAccountCodeAndPeriodId(accountCode, periodId, pageable)
                .map(mapper::toLineDto);
    }
}
