package io.restaurantos.finance.dto;

import io.restaurantos.finance.domain.enums.ArTxnType;

import java.time.LocalDate;
import java.util.UUID;

public record ArTransactionDto(
        UUID id,
        UUID customerAccountId,
        ArTxnType txnType,
        LocalDate txnDate,
        LocalDate dueDate,
        long amountPaisa,
        String sourceType,
        UUID sourceId,
        UUID journalEntryId,
        String reference,
        String memo,
        long balanceAfterPaisa
) {}
