package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.model.JournalLine;
import io.restaurantos.finance.dto.ApAgingBucketDto;
import io.restaurantos.finance.dto.ApAgingReportDto;
import io.restaurantos.finance.repository.JournalLineRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

@Service
public class ApAgingService {

    private static final String AP_ACCOUNT = "2100";

    private final JournalLineRepository lineRepository;
    private final TenantContext tenantContext;

    public ApAgingService(JournalLineRepository lineRepository, TenantContext tenantContext) {
        this.lineRepository = lineRepository;
        this.tenantContext = tenantContext;
    }

    @Transactional(readOnly = true)
    public ApAgingReportDto getAging(UUID branchId, LocalDate asOf) {
        tenantContext.requireTenantId();
        List<JournalLine> lines = lineRepository.findPostedApLines(AP_ACCOUNT, branchId);

        long current = 0;
        long days31to60 = 0;
        long days61to90 = 0;
        long over90 = 0;

        for (JournalLine line : lines) {
            long net = line.getCreditPaisa() - line.getDebitPaisa();
            if (net <= 0) {
                continue;
            }
            long age = ChronoUnit.DAYS.between(line.getJournalEntry().getEntryDate(), asOf);
            if (age <= 30) {
                current += net;
            } else if (age <= 60) {
                days31to60 += net;
            } else if (age <= 90) {
                days61to90 += net;
            } else {
                over90 += net;
            }
        }

        long total = current + days31to60 + days61to90 + over90;
        return new ApAgingReportDto(total, List.of(
                new ApAgingBucketDto("Current", 0, 30, current),
                new ApAgingBucketDto("31-60 days", 31, 60, days31to60),
                new ApAgingBucketDto("61-90 days", 61, 90, days61to90),
                new ApAgingBucketDto("Over 90 days", 91, Integer.MAX_VALUE, over90)));
    }
}
