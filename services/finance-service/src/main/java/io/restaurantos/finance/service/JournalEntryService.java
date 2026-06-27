package io.restaurantos.finance.service;

import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.dto.JournalEntryDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.time.LocalDate;
import java.util.UUID;

public interface JournalEntryService {

    JournalEntryDto create(CreateJeRequest req);

    JournalEntryDto post(UUID jeId);

    JournalEntryDto reverse(UUID jeId);

    JournalEntryDto getById(UUID jeId);

    Page<JournalEntryDto> listByPeriod(UUID periodId, Pageable pageable);

    Page<JournalEntryDto> listByDateRange(LocalDate from, LocalDate to, Pageable pageable);

    InternalJePostResponse autoPostInternal(InternalAutoPostJeRequest req);
}
