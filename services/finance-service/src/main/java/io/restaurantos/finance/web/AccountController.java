package io.restaurantos.finance.web;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.dto.AccountDto;
import io.restaurantos.finance.dto.CreateAccountRequest;
import io.restaurantos.finance.service.CoaService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.net.URI;

@RestController
@RequestMapping("/api/v1/finance/accounts")
public class AccountController {

    private final CoaService coaService;

    public AccountController(CoaService coaService) {
        this.coaService = coaService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('finance.accounts.read')")
    public ResponseEntity<Page<AccountDto>> listAccounts(
            @RequestParam(required = false) AccountType type,
            @RequestParam(required = false) Boolean active,
            @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(coaService.listAccounts(type, active, pageable));
    }

    @GetMapping("/{code}")
    @PreAuthorize("hasAuthority('finance.accounts.read')")
    public ResponseEntity<AccountDto> getAccount(@PathVariable String code) {
        return ResponseEntity.ok(coaService.getAccountByCode(code));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('finance.accounts.write')")
    public ResponseEntity<AccountDto> createAccount(@Valid @RequestBody CreateAccountRequest req) {
        AccountDto created = coaService.createCustomAccount(req);
        return ResponseEntity.created(URI.create("/api/v1/finance/accounts/" + created.code()))
                .body(created);
    }
}
