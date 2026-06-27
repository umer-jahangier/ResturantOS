package io.restaurantos.finance.web;

import io.restaurantos.finance.dto.GlBalanceDto;
import io.restaurantos.finance.dto.JournalLineDto;
import io.restaurantos.finance.service.GlService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/finance/gl")
public class GlController {

    private final GlService glService;

    public GlController(GlService glService) {
        this.glService = glService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('finance.gl.read')")
    public ResponseEntity<List<GlBalanceDto>> getBalances(@RequestParam UUID periodId) {
        return ResponseEntity.ok(glService.getGlBalances(periodId));
    }

    @GetMapping("/{accountCode}/entries")
    @PreAuthorize("hasAuthority('finance.gl.read')")
    public ResponseEntity<Page<JournalLineDto>> getEntries(
            @PathVariable String accountCode,
            @RequestParam UUID periodId,
            @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(glService.getGlEntries(accountCode, periodId, pageable));
    }
}
