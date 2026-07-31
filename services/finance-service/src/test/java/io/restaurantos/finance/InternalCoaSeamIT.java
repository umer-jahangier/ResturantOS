package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.dto.AccountDto;
import io.restaurantos.finance.service.CoaService;
import io.restaurantos.finance.service.ProvisioningService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The chart-of-accounts seam other services call to offer their own users an account picker
 * ({@code /internal/finance/accounts/**}).
 *
 * <p>It exists so inventory can let a manager choose GL accounts for an item category WITHOUT
 * granting them {@code finance.coa.view} — a permission held only by OWNER / TENANT_ADMIN /
 * ACCOUNTANT / FINANCE_VIEWER, and one that carries the whole finance read surface. Handing that
 * out so somebody can fill in three fields on a category form is the wrong trade; a narrow,
 * type-filtered, read-only seam is the right one.
 *
 * <p>These tests exercise the service layer the internal endpoints delegate to, which is where all
 * the narrowing actually happens — the controller only unwraps the tenant header.
 */
class InternalCoaSeamIT extends FinanceTestBase {

    @Autowired private CoaService coaService;
    @Autowired private ProvisioningService provisioningService;

    private UUID provisionedTenant() {
        UUID tenantId = UUID.randomUUID();
        provisioningService.provision(tenantId, 2026);
        return tenantId;
    }

    @Test
    void searchIsNarrowedToTheRequestedAccountTypes() {
        UUID tenantId = provisionedTenant();

        List<AccountDto> assets = coaService.searchActiveAccountsForTenant(
                tenantId, "", List.of(AccountType.ASSET), PageRequest.of(0, 50)).getContent();

        assertThat(assets).isNotEmpty();
        // The caller asked for assets, so nothing else can come back — this is the whole point of
        // the seam, and it means an inventory slot expecting an asset account cannot be handed a
        // revenue one to choose from.
        assertThat(assets).allSatisfy(a -> assertThat(a.accountType()).isEqualTo(AccountType.ASSET));
    }

    @Test
    void searchWithNoQueryReturnsAFirstPageRatherThanNothing() {
        UUID tenantId = provisionedTenant();

        // Unlike the user-facing searchActiveAccounts (which returns empty until you type), a
        // picker needs something to show the moment it opens.
        List<AccountDto> firstPage = coaService.searchActiveAccountsForTenant(
                tenantId, null, List.of(AccountType.ASSET), PageRequest.of(0, 5)).getContent();

        assertThat(firstPage).isNotEmpty().hasSizeLessThanOrEqualTo(5);
    }

    @Test
    void searchMatchesOnCodeOrName() {
        UUID tenantId = provisionedTenant();

        List<AccountDto> byCode = coaService.searchActiveAccountsForTenant(
                tenantId, "1010", List.of(AccountType.ASSET), PageRequest.of(0, 20)).getContent();
        assertThat(byCode).extracting(AccountDto::code).contains("1010");

        String name = byCode.get(0).name();
        List<AccountDto> byName = coaService.searchActiveAccountsForTenant(
                tenantId, name, List.of(AccountType.ASSET), PageRequest.of(0, 20)).getContent();
        assertThat(byName).extracting(AccountDto::name).contains(name);
    }

    @Test
    void searchNeverCrossesTenants() {
        UUID tenantA = provisionedTenant();
        UUID tenantB = provisionedTenant();

        List<AccountDto> aAccounts = coaService.searchActiveAccountsForTenant(
                tenantA, "", List.of(AccountType.ASSET), PageRequest.of(0, 200)).getContent();
        List<AccountDto> bAccounts = coaService.searchActiveAccountsForTenant(
                tenantB, "", List.of(AccountType.ASSET), PageRequest.of(0, 200)).getContent();

        // Same codes (both seeded from the same template), but never the same rows — the query is
        // explicitly tenant-scoped rather than leaning on an ambient filter, because the tenant
        // arrives as a header on an internal call with no user principal behind it.
        assertThat(aAccounts).isNotEmpty();
        assertThat(aAccounts).extracting(AccountDto::id)
                .doesNotContainAnyElementsOf(bAccounts.stream().map(AccountDto::id).toList());
    }

    @Test
    void resolveByCodesReturnsOnlyTheCodesThatExist() {
        UUID tenantId = provisionedTenant();

        Map<String, AccountDto> resolved = coaService.resolveByCodes(tenantId, List.of("1010", "NOPE-9999"));

        // An absent key is how the CALLER learns which of ITS OWN fields was wrong — inventory can
        // say "the Inventory GL account 14OO doesn't exist" rather than failing the whole save with
        // one undifferentiated message.
        assertThat(resolved).containsKey("1010");
        assertThat(resolved).doesNotContainKey("NOPE-9999");
    }

    @Test
    void resolveByCodesIsEmptyForAnotherTenantsCodes() {
        UUID tenantA = provisionedTenant();
        UUID tenantB = provisionedTenant();

        String codeFromA = coaService.resolveByCodes(tenantA, List.of("1010")).get("1010").code();
        Map<String, AccountDto> seenFromB = coaService.resolveByCodes(tenantB, List.of(codeFromA));

        // B has its own 1010, so the code resolves — but to B's row, never A's.
        assertThat(seenFromB.get("1010").id())
                .isNotEqualTo(coaService.resolveByCodes(tenantA, List.of("1010")).get("1010").id());
    }

    @Test
    void resolveByIdsRoundTripsTheImmutableReference() {
        UUID tenantId = provisionedTenant();
        AccountDto account = coaService.resolveByCodes(tenantId, List.of("1010")).get("1010");

        Map<UUID, AccountDto> byId = coaService.resolveByIds(tenantId, List.of(account.id()));

        // Storing the id is what survives a chart-of-accounts renumbering; this is the read that
        // turns it back into something displayable.
        assertThat(byId.get(account.id()).code()).isEqualTo("1010");
    }

    @Test
    void emptyInputsCostNothing() {
        UUID tenantId = provisionedTenant();

        assertThat(coaService.resolveByCodes(tenantId, List.of())).isEmpty();
        assertThat(coaService.resolveByIds(tenantId, List.of())).isEmpty();
        assertThat(coaService.searchActiveAccountsForTenant(
                tenantId, "x", List.of(), PageRequest.of(0, 10)).getContent()).isEmpty();
    }
}
