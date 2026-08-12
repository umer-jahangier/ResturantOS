package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.DailyTakingsDto;
import io.restaurantos.pos.service.DailyTakingsService;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Daily takings, reconciled (37-09, D-37-02) — the number a restaurant owner looks at first.
 *
 * <p>Gated by {@code pos.order.view.all} OR {@code finance.journal.view} OR {@code pos.till.review},
 * all three of which are really seeded (checked against the catalogue, not assumed — the 37-08 plan
 * named a {@code pos.report.view} that exists nowhere). {@code pos.till.review} is included because
 * a MANAGER cashing up holds it and it is precisely the permission for "did the drawer match".
 */
@RestController
@RequestMapping("/api/v1/pos/takings")
public class DailyTakingsController {

    private final DailyTakingsService service;

    public DailyTakingsController(DailyTakingsService service) {
        this.service = service;
    }

    @GetMapping("/daily")
    @PreAuthorize("hasAnyAuthority('pos.order.view.all','finance.journal.view','pos.till.review')")
    public ResponseEntity<ApiResponse<DailyTakingsDto>> daily(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) UUID branchId) {
        // Defaulting to the CALENDAR date was wrong: the trading day runs (t − 4h) ON THE BRANCH'S
        // OWN CLOCK, so a cash-up screen that defaulted to today showed an empty page to the person
        // holding the drawer. The rule lives in DailyTakingsService, next to the queries that apply
        // it, so the default and the aggregation cannot drift apart — and it is no longer static,
        // because "which day is it" has no answer until you say which restaurant is asking. S0-C:
        // this default was computed in UTC and, for Asia/Karachi, named yesterday until 09:00 local
        // every morning.
        LocalDate businessDate = date != null ? date : service.currentBusinessDate(branchId);
        return ResponseEntity.ok(ApiResponse.ok(service.forDate(businessDate, branchId)));
    }
}
