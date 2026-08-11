package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.TransactionFilterRequest;
import io.restaurantos.pos.dto.TransactionRegisterPage;
import io.restaurantos.pos.dto.TransactionRowDto;
import io.restaurantos.pos.repository.TransactionRegisterRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.temporal.ChronoUnit;
import java.util.List;

/** The transaction register (37-08, D-37-01). */
@Service
public class TransactionRegisterService {

    private final TransactionRegisterRepository repository;

    public TransactionRegisterService(TransactionRegisterRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public TransactionRegisterPage query(TransactionFilterRequest filter) {
        validate(filter);
        List<TransactionRowDto> rows = repository.findRows(filter);
        long[] t = repository.totals(filter);
        return new TransactionRegisterPage(rows, filter.pageOrDefault(), filter.sizeOrDefault(),
                t[0], t[1], t[2], t[3], t[4]);
    }

    /**
     * The range bound. {@code orders} is the busiest table in the product; an unbounded register is
     * a denial-of-service surface any authenticated user can reach in one request. The message names
     * the limit so the refusal is actionable rather than mysterious.
     */
    private void validate(TransactionFilterRequest f) {
        if (f.from() == null || f.to() == null) {
            throw new IllegalArgumentException("A date range is required: supply both 'from' and 'to'.");
        }
        if (f.to().isBefore(f.from())) {
            throw new IllegalArgumentException("'to' (" + f.to() + ") is before 'from' (" + f.from() + ").");
        }
        long days = ChronoUnit.DAYS.between(f.from(), f.to()) + 1;
        if (days > TransactionFilterRequest.MAX_RANGE_DAYS) {
            throw new IllegalArgumentException(
                    "Date range of " + days + " days exceeds the maximum of "
                            + TransactionFilterRequest.MAX_RANGE_DAYS
                            + " days. Narrow the range and try again.");
        }
    }
}
