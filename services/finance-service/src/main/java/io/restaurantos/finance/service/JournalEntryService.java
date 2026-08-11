package io.restaurantos.finance.service;

import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.dto.JournalEntryDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface JournalEntryService {

    JournalEntryDto create(CreateJeRequest req);

    JournalEntryDto post(UUID jeId);

    JournalEntryDto reverse(UUID jeId);

    JournalEntryDto getById(UUID jeId);

    Page<JournalEntryDto> listByPeriod(UUID periodId, Pageable pageable);

    Page<JournalEntryDto> listByDateRange(LocalDate from, LocalDate to, Pageable pageable);

    /**
     * Every journal entry a source produced, oldest first (37-04, D-37-01).
     *
     * <p>Returns an EMPTY list, never a 404, when the source produced nothing. "This order produced
     * no entries" is a true and useful answer to an owner asking where a number came from; a 404
     * would say "no such order", which is a different and usually false statement.
     *
     * @param sourceType optional filter; pass {@code null} for every entry regardless of type,
     *                   which is what tracing an order actually requires
     */
    List<JournalEntryDto> listBySource(UUID sourceId, String sourceType);

    /**
     * As {@link #listBySource}, optionally enriching each entry with a human-readable source
     * reference (37-04).
     *
     * @param resolveSource when false (the default everywhere it is not explicitly asked for), NO
     *                      pos lookup is performed at all. The register in 37-08 renders many rows
     *                      and an eager per-row lookup would turn one screen into N network calls.
     */
    List<JournalEntryDto> listBySource(UUID sourceId, String sourceType, boolean resolveSource);

    InternalJePostResponse autoPostInternal(InternalAutoPostJeRequest req);
}
