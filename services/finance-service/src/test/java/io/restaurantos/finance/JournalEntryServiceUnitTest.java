package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.domain.model.AccountingPeriod;
import io.restaurantos.finance.domain.model.JournalEntry;
import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.exception.JeAlreadyPostedException;
import io.restaurantos.finance.exception.PeriodLockedException;
import io.restaurantos.finance.mapper.JournalEntryMapper;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.finance.repository.JeSequenceRepository;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.JournalEntryServiceImpl;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class JournalEntryServiceUnitTest {

    @Mock
    private JournalEntryRepository jeRepo;
    @Mock
    private AccountingPeriodRepository periodRepo;
    @Mock
    private JeSequenceRepository jeSeqRepo;
    @Mock
    private JournalEntryMapper mapper;
    @Mock
    private TenantContext tenantContext;

    private JournalEntryServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new JournalEntryServiceImpl(jeRepo, periodRepo, jeSeqRepo, mapper, tenantContext);
    }

    @Test
    void create_withValidRequest_returnsDraftJe() {
        UUID tenantId = UUID.randomUUID();
        AccountingPeriod period = new AccountingPeriod();
        period.setStatus(PeriodStatus.OPEN);

        when(tenantContext.requireTenantId()).thenReturn(tenantId);
        when(periodRepo.findByTenantIdAndStartDateLessThanEqualAndEndDateGreaterThanEqual(any(), any(), any()))
                .thenReturn(Optional.of(period));

        JournalEntry savedJe = new JournalEntry();
        savedJe.setId(UUID.randomUUID());
        savedJe.setStatus(JeStatus.DRAFT);
        savedJe.setLines(new ArrayList<>());
        savedJe.setPeriod(period);
        savedJe.setEntryDate(LocalDate.now());

        when(jeRepo.save(any())).thenReturn(savedJe);

        JournalEntryDto expectedDto = new JournalEntryDto(
                savedJe.getId(), null, null, LocalDate.now(),
                "Test", null, null, JeStatus.DRAFT,
                null, false, null, null, List.of()
        );
        when(mapper.toDto(any())).thenReturn(expectedDto);

        var result = service.create(new CreateJeRequest(
                LocalDate.now(), "Test", null, null, null,
                List.of(new CreateJeLineRequest("1010", "Cash", 1000L, 0L))
        ));

        assertThat(result.status()).isEqualTo(JeStatus.DRAFT);
        verify(jeRepo).save(any(JournalEntry.class));
    }

    @Test
    void post_withLockedPeriod_throwsPeriodLockedException() {
        UUID jeId = UUID.randomUUID();
        AccountingPeriod lockedPeriod = new AccountingPeriod();
        lockedPeriod.setId(UUID.randomUUID());
        lockedPeriod.setStatus(PeriodStatus.LOCKED);

        JournalEntry draftJe = new JournalEntry();
        draftJe.setId(jeId);
        draftJe.setStatus(JeStatus.DRAFT);
        draftJe.setPeriod(lockedPeriod);

        when(jeRepo.findById(jeId)).thenReturn(Optional.of(draftJe));

        assertThatThrownBy(() -> service.post(jeId))
                .isInstanceOf(PeriodLockedException.class);
    }

    @Test
    void post_alreadyPosted_throwsJeAlreadyPostedException() {
        UUID jeId = UUID.randomUUID();
        JournalEntry postedJe = new JournalEntry();
        postedJe.setId(jeId);
        postedJe.setStatus(JeStatus.POSTED);

        when(jeRepo.findById(jeId)).thenReturn(Optional.of(postedJe));

        assertThatThrownBy(() -> service.post(jeId))
                .isInstanceOf(JeAlreadyPostedException.class);
    }
}
