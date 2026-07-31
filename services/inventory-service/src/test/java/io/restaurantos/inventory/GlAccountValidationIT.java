package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.dto.ItemCategoryDtos.CreateItemCategoryRequest;
import io.restaurantos.inventory.feign.GlAccountDto;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * GL account validation on category writes, and the scoped account-picker endpoint behind it.
 *
 * <p>These three fields were free text with NO validation whatsoever — {@code '1400'},
 * {@code '14OO'} and {@code 'banana'} all saved identically, and would only surface once Phase 9
 * started posting journal entries, far from whoever mistyped them. Every rejection asserted here
 * is a value that used to save silently.
 *
 * <p>The finance-service seam is mocked at the transport boundary by {@link InventoryTestBase},
 * whose default stub resolves any code to a plausible account; each test below re-stubs it to
 * describe the specific chart-of-accounts state it is about.
 */
class GlAccountValidationIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired ItemCategoryRepository itemCategoryRepository;

    @MockitoBean FeatureFlagService featureFlagService;

    MockMvc mockMvc;
    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));
    }

    private RequestPostProcessor asManager() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("INVENTORY_MANAGER"),
                List.of("inventory.item.view", "inventory.item.manage"), Map.of(), null);
        var authentication = new UsernamePasswordAuthenticationToken(claims, null, List.of());
        return SecurityMockMvcRequestPostProcessors.authentication(authentication);
    }

    // ---- fixtures ----

    /** (parentId, name, code, inventoryAccount, costAccount, wasteAccount, varianceCap, excludePo, sortOrder) */
    private static CreateItemCategoryRequest category(String name, String inventoryCode, String costCode) {
        return new CreateItemCategoryRequest(null, name, null, inventoryCode, costCode, null, null, null, null);
    }

    private void financeResolves(Map<String, GlAccountDto> accounts) {
        when(financeCoaClient.resolveByCodes(any(), anyList())).thenReturn(ApiResponse.ok(accounts));
    }

    private static GlAccountDto account(String code, String name, String type, boolean active) {
        return new GlAccountDto(UUID.randomUUID(), code, name, type, null, false, null, active);
    }

    private MvcResult createCategory(CreateItemCategoryRequest request, int expectedStatus) throws Exception {
        return mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().is(expectedStatus))
                .andReturn();
    }

    // ---- write validation ----

    @Test
    void anAccountCodeThatDoesNotExistIsRejected() throws Exception {
        financeResolves(Map.of());   // the chart of accounts has no such code

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(category("Proteins", "14OO", null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("GL_ACCOUNT_NOT_FOUND"));
    }

    @Test
    void anArchivedAccountIsRejected() throws Exception {
        financeResolves(Map.of("1400", account("1400", "Food Inventory", "ASSET", false)));

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(category("Proteins", "1400", null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("GL_ACCOUNT_INACTIVE"));
    }

    @Test
    void anAccountOfTheWrongTypeIsRejected() throws Exception {
        // A revenue account in the inventory ASSET slot — well-formed, real, and completely wrong.
        financeResolves(Map.of("4000", account("4000", "Food Sales", "REVENUE", true)));

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(category("Proteins", "4000", null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("GL_ACCOUNT_TYPE_INVALID"));
    }

    @Test
    void aCogsAccountIsAcceptedForTheCostSlotButNotTheInventorySlot() throws Exception {
        financeResolves(Map.of("5010", account("5010", "Food Cost", "COGS", true)));

        createCategory(category("Proteins", null, "5010"), 200);

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(category("Dairy", "5010", null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("GL_ACCOUNT_TYPE_INVALID"));
    }

    @Test
    void theResolvedAccountsIdAndCanonicalCodeAreBothPersisted() throws Exception {
        GlAccountDto inventoryAccount = account("1400", "Food Inventory", "ASSET", true);
        financeResolves(Map.of("1400", inventoryAccount));

        MvcResult result = createCategory(category("Proteins", "1400", null), 200);
        UUID categoryId = UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("id").asText());

        ItemCategory saved = itemCategoryRepository.findByTenantIdAndId(tenantId, categoryId).orElseThrow();
        // The id is the durable reference — a chart-of-accounts renumbering moves the code, not this.
        assertThat(saved.getDefaultInventoryAccountId()).isEqualTo(inventoryAccount.id());
        // ...and the code stored is the ACCOUNT's own, never the raw request string.
        assertThat(saved.getDefaultInventoryAccountCode()).isEqualTo("1400");
    }

    @Test
    void aCategoryWithNoAccountsNeverCallsFinance() throws Exception {
        createCategory(category("Uncategorised", null, null), 200);

        // Clearing a field means "inherit from the parent" and needs no lookup — a category form
        // that names no accounts must not pay a cross-service round trip, nor be blocked by one.
        verify(financeCoaClient, never()).resolveByCodes(any(), anyList());
    }

    @Test
    void aFinanceOutageFailsClosedWith503RatherThanSavingUnverified() throws Exception {
        when(financeCoaClient.resolveByCodes(any(), anyList()))
                .thenThrow(new IllegalStateException("connection refused"));

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(category("Proteins", "1400", null))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("FINANCE_UNAVAILABLE"));

        assertThat(itemCategoryRepository.findByTenantIdOrderBySortOrderAscNameAsc(tenantId)).isEmpty();
    }

    // ---- read paths ----

    @Test
    void inheritedAccountsCarryTheirSourceCategoryAndName() throws Exception {
        financeResolves(Map.of("5010", account("5010", "Food Cost", "COGS", true)));

        MvcResult rootResult = createCategory(category("Proteins", null, "5010"), 200);
        UUID rootId = UUID.fromString(objectMapper.readTree(rootResult.getResponse().getContentAsString())
                .path("data").path("id").asText());

        MvcResult childResult = mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateItemCategoryRequest(
                                rootId, "Poultry", null, null, null, null, null, null, null))))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode gl = objectMapper.readTree(childResult.getResponse().getContentAsString())
                .path("data").path("resolvedGlAccounts");
        assertThat(gl.path("costAccountCode").asText()).isEqualTo("5010");
        assertThat(gl.path("costInherited").asBoolean()).isTrue();
        // These two are what let the form say "Inherited from Proteins — 5010 · Food Cost" instead
        // of showing a bare number in a field the manager never filled in.
        assertThat(gl.path("costInheritedFrom").asText()).isEqualTo("Proteins");
        assertThat(gl.path("costAccountName").asText()).isEqualTo("Food Cost");
    }

    @Test
    void browsingCategoriesStillWorksWhenFinanceIsDown() throws Exception {
        financeResolves(Map.of("5010", account("5010", "Food Cost", "COGS", true)));
        createCategory(category("Proteins", null, "5010"), 200);

        // Reads are best-effort, unlike writes: a manager must still be able to see and reorganise
        // their categories while accounting is unreachable. They lose the account NAME, not the page.
        when(financeCoaClient.resolveByCodes(any(), anyList()))
                .thenThrow(new IllegalStateException("connection refused"));

        MvcResult result = mockMvc.perform(get("/api/v1/inventory/categories").with(asManager()))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode gl = objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").get(0).path("resolvedGlAccounts");
        assertThat(gl.path("costAccountCode").asText()).isEqualTo("5010");
        assertThat(gl.path("costAccountName").isNull()).isTrue();
    }

    // ---- the scoped picker endpoint ----

    @Test
    void theAccountPickerAsksFinanceOnlyForTypesTheSlotAccepts() throws Exception {
        when(financeCoaClient.searchAccounts(any(), any(), anyList(), anyInt()))
                .thenReturn(ApiResponse.ok(List.of(account("1400", "Food Inventory", "ASSET", true))));

        mockMvc.perform(get("/api/v1/inventory/gl-accounts")
                        .param("usage", "INVENTORY")
                        .param("q", "food")
                        .with(asManager()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].code").value("1400"))
                .andExpect(jsonPath("$.data[0].name").value("Food Inventory"))
                .andExpect(jsonPath("$.data[0].accountType").value("ASSET"));

        // The narrowing happens server-side: an inventory slot never even asks for anything but
        // assets, so the browser is not trusted to filter the chart of accounts.
        verify(financeCoaClient).searchAccounts(eq(tenantId), eq("food"), eq(List.of("ASSET")), anyInt());
    }

    @Test
    void theAccountPickerIsReachableWithOnlyInventoryPermissions() throws Exception {
        when(financeCoaClient.searchAccounts(any(), any(), anyList(), anyInt()))
                .thenReturn(ApiResponse.ok(List.of()));

        // asManager() holds inventory.item.view/manage and NO finance permission at all — the
        // entire reason this endpoint exists rather than granting finance.coa.view to inventory
        // roles just so three fields can be filled in.
        mockMvc.perform(get("/api/v1/inventory/gl-accounts")
                        .param("usage", "COST")
                        .with(asManager()))
                .andExpect(status().isOk());
    }
}
