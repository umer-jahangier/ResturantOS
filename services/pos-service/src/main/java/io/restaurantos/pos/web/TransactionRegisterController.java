package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.TransactionFilterRequest;
import io.restaurantos.pos.dto.TransactionRegisterPage;
import io.restaurantos.pos.dto.TransactionRowDto;
import io.restaurantos.pos.service.TransactionRegisterService;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The transaction register (37-08, D-37-01) — "there was no system to see all the orders
 * transactions in the app". This is that system's endpoint.
 *
 * <h2>The permission gate, and why it is two codes</h2>
 *
 * <p>The plan named {@code pos.report.view}. <b>That permission does not exist.</b> Checked against
 * the seeded catalogue before wiring it — guarding with an unseeded code produces an endpoint
 * nobody in the product can call, which is the trap this plan's own reading list warns about.
 *
 * <p>The seeded codes and who actually holds them:
 * <pre>
 *   pos.order.view       ACCOUNTANT, CASHIER, MANAGER, OWNER, TENANT_ADMIN, WAITER
 *   pos.order.view.all   MANAGER, OWNER, TENANT_ADMIN
 *   finance.journal.view ACCOUNTANT, OWNER, TENANT_ADMIN
 * </pre>
 *
 * <p>{@code pos.order.view} is far too broad — a waiter and a cashier would see every tender the
 * business took. {@code pos.order.view.all} alone excludes the ACCOUNTANT, who is precisely the
 * persona this register exists for. So either code opens it: an owner or manager arrives through
 * pos, an accountant through finance, and no waiter or cashier through either.
 */
@RestController
@RequestMapping("/api/v1/pos/transactions")
public class TransactionRegisterController {

    private final TransactionRegisterService service;

    public TransactionRegisterController(TransactionRegisterService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAnyAuthority('pos.order.view.all','finance.journal.view')")
    public ResponseEntity<ApiResponse<TransactionRegisterPage>> list(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) UUID branchId,
            @RequestParam(required = false) UUID cashierId,
            @RequestParam(required = false) String tenderMethod,
            @RequestParam(required = false) List<String> statuses,
            @RequestParam(required = false) List<TransactionRowDto.EventKind> eventKinds,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(ApiResponse.ok(service.query(new TransactionFilterRequest(
                from, to, branchId, cashierId, tenderMethod, statuses, eventKinds, page, size))));
    }
}
