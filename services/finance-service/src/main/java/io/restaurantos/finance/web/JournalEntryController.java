package io.restaurantos.finance.web;

import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/finance/journal-entries")
public class JournalEntryController {

    private final JournalEntryService jeService;

    public JournalEntryController(JournalEntryService jeService) {
        this.jeService = jeService;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('finance.journal.post')")
    public ResponseEntity<ApiResponse<JournalEntryDto>> create(@Valid @RequestBody CreateJeRequest req) {
        JournalEntryDto created = jeService.create(req);
        return ResponseEntity.created(URI.create("/api/v1/finance/journal-entries/" + created.id()))
                .body(ApiResponse.ok(created));
    }

    /**
     * @param q free-text search on entry number or description. When present it wins over every
     *          other selector and searches the branch's WHOLE ledger, because the question it
     *          answers — "which entry is order ORD-20260812-0164?" — carries no date and no
     *          period. Blank is treated as absent rather than as "match everything with an empty
     *          string", so clearing the box returns the normal list instead of a silent full scan.
     */
    @GetMapping
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ResponseEntity<ApiResponse<List<JournalEntryDto>>> list(
            @RequestParam(required = false) UUID periodId,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @PageableDefault(size = 50) Pageable pageable) {
        Page<JournalEntryDto> page;
        if (q != null && !q.isBlank()) {
            page = jeService.search(q, pageable);
        } else if (periodId != null) {
            page = jeService.listByPeriod(periodId, pageable);
        } else if (from != null && to != null) {
            page = jeService.listByDateRange(from, to, pageable);
        } else {
            page = jeService.listByDateRange(
                    LocalDate.now().minusMonths(1), LocalDate.now(), pageable);
        }
        return ResponseEntity.ok(toPaginated(page));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ResponseEntity<ApiResponse<JournalEntryDto>> getById(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(jeService.getById(id)));
    }

    /**
     * Every journal entry a source produced (37-04, D-37-01).
     *
     * <p>Placed under {@code /by-source/} rather than as a query parameter on the list endpoint so
     * that it cannot be confused with the paginated date-range read, which is branch-scoped and
     * page-shaped; this one is neither.
     *
     * <p>Takes NO tenant parameter, deliberately. The tenant comes from the authenticated context
     * and is enforced by the FORCE RLS policy on journal_entries. A caller has no way to ask about
     * another tenant's order because there is nowhere to put the tenant id.
     *
     * <p>Returns 200 with an empty list when the source produced nothing — see
     * {@link io.restaurantos.finance.service.JournalEntryService#listBySource} for why that is not
     * a 404.
     *
     * @param sourceType optional. Omit it to get every entry the source produced regardless of
     *                   type, which is what tracing an order requires.
     */
    @GetMapping("/by-source/{sourceId}")
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ResponseEntity<ApiResponse<List<JournalEntryDto>>> listBySource(
            @PathVariable UUID sourceId,
            @RequestParam(required = false) String sourceType,
            @RequestParam(defaultValue = "false") boolean resolveSource) {
        return ResponseEntity.ok(ApiResponse.ok(
                jeService.listBySource(sourceId, sourceType, resolveSource)));
    }

    @PostMapping("/{id}/post")
    @PreAuthorize("hasAuthority('finance.journal.post')")
    public ResponseEntity<ApiResponse<JournalEntryDto>> post(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(jeService.post(id)));
    }

    @PostMapping("/{id}/reverse")
    @PreAuthorize("hasAuthority('finance.journal.reverse')")
    public ResponseEntity<ApiResponse<JournalEntryDto>> reverse(@PathVariable UUID id) {
        JournalEntryDto reversal = jeService.reverse(id);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(reversal));
    }

    private static <T> ApiResponse<List<T>> toPaginated(Page<T> page) {
        return ApiResponse.paginated(page.getContent(), new PageMeta(
                new PageMeta.Page(
                        String.valueOf(page.getNumber()),
                        page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                        page.getSize()),
                page.getTotalElements()));
    }
}
