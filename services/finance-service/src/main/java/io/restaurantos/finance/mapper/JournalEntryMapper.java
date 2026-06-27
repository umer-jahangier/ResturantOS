package io.restaurantos.finance.mapper;

import io.restaurantos.finance.domain.model.JournalEntry;
import io.restaurantos.finance.domain.model.JournalLine;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.dto.JournalLineDto;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class JournalEntryMapper {

    public JournalEntryDto toDto(JournalEntry je) {
        if (je == null) return null;
        List<JournalLineDto> lineDtos = je.getLines().stream()
                .map(this::toLineDto)
                .toList();
        return new JournalEntryDto(
                je.getId(),
                je.getEntryNo(),
                je.getPeriod() != null ? je.getPeriod().getId() : null,
                je.getEntryDate(),
                je.getDescription(),
                je.getSourceType(),
                je.getSourceId(),
                je.getStatus(),
                je.getPostedBy(),
                je.isReversal(),
                je.getReversalOfJe(),
                je.getReversedByJe(),
                lineDtos
        );
    }

    public JournalLineDto toLineDto(JournalLine line) {
        return new JournalLineDto(
                line.getId(),
                line.getAccountCode(),
                line.getDescription(),
                line.getDebitPaisa(),
                line.getCreditPaisa()
        );
    }
}
