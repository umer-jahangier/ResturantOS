package io.restaurantos.finance.dto;

import io.restaurantos.finance.domain.enums.JeStatus;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record JournalEntryDto(
        UUID id,
        String entryNo,
        UUID periodId,
        LocalDate entryDate,
        String description,
        String sourceType,
        UUID sourceId,
        JeStatus status,
        UUID postedBy,
        boolean reversal,
        UUID reversalOfJe,
        UUID reversedByJe,
        long totalDebitPaisa,
        long totalCreditPaisa,
        List<JournalLineDto> lines,
        /**
         * What produced this entry, in words (37-04). NULL when the caller did not ask for it —
         * the register in 37-08 renders many rows and an eager per-row lookup would turn one
         * screen into a hundred network calls. Never null-as-"unknown": when it IS requested it
         * always carries an explicit state, including "entered by hand" and "could not be read".
         */
        SourceReferenceDto sourceReference
) {
    /** The ledger fields, with no source reference attached. */
    public JournalEntryDto withoutSourceReference() {
        return new JournalEntryDto(id, entryNo, periodId, entryDate, description, sourceType,
                sourceId, status, postedBy, reversal, reversalOfJe, reversedByJe,
                totalDebitPaisa, totalCreditPaisa, lines, null);
    }

    public JournalEntryDto withSourceReference(SourceReferenceDto reference) {
        return new JournalEntryDto(id, entryNo, periodId, entryDate, description, sourceType,
                sourceId, status, postedBy, reversal, reversalOfJe, reversedByJe,
                totalDebitPaisa, totalCreditPaisa, lines, reference);
    }
}
