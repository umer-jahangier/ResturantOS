package io.restaurantos.finance.web;

import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.service.JournalEntryService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.time.LocalDate;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/finance/journal-entries")
public class JournalEntryController {

    private final JournalEntryService jeService;

    public JournalEntryController(JournalEntryService jeService) {
        this.jeService = jeService;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('finance.journal.write')")
    public ResponseEntity<JournalEntryDto> create(@Valid @RequestBody CreateJeRequest req) {
        JournalEntryDto created = jeService.create(req);
        return ResponseEntity.created(URI.create("/api/v1/finance/journal-entries/" + created.id()))
                .body(created);
    }

    @GetMapping
    @PreAuthorize("hasAuthority('finance.journal.read')")
    public ResponseEntity<Page<JournalEntryDto>> list(
            @RequestParam(required = false) UUID periodId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @PageableDefault(size = 50) Pageable pageable) {
        if (periodId != null) {
            return ResponseEntity.ok(jeService.listByPeriod(periodId, pageable));
        }
        if (from != null && to != null) {
            return ResponseEntity.ok(jeService.listByDateRange(from, to, pageable));
        }
        return ResponseEntity.ok(jeService.listByDateRange(LocalDate.now().minusMonths(1), LocalDate.now(), pageable));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('finance.journal.read')")
    public ResponseEntity<JournalEntryDto> getById(@PathVariable UUID id) {
        return ResponseEntity.ok(jeService.getById(id));
    }

    @PostMapping("/{id}/post")
    @PreAuthorize("hasAuthority('finance.journal.post')")
    public ResponseEntity<JournalEntryDto> post(@PathVariable UUID id) {
        return ResponseEntity.ok(jeService.post(id));
    }

    @PostMapping("/{id}/reverse")
    @PreAuthorize("hasAuthority('finance.journal.write')")
    public ResponseEntity<JournalEntryDto> reverse(@PathVariable UUID id) {
        JournalEntryDto reversal = jeService.reverse(id);
        return ResponseEntity.status(201).body(reversal);
    }
}
