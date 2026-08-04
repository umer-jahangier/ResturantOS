package io.restaurantos.purchasing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorItem;
import io.restaurantos.purchasing.domain.model.VendorItemPrice;
import io.restaurantos.purchasing.feign.InventoryReorderClient;
import io.restaurantos.purchasing.feign.InventoryReorderClient.ReorderShortfall;
import io.restaurantos.purchasing.repository.VendorItemPriceRepository;
import io.restaurantos.purchasing.repository.VendorItemRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Order suggestions: the join that turns inventory's "what is low, by how much" into "what to buy,
 * from whom" — and the first thing anywhere to make {@code ingredients.par_level} matter.
 *
 * <p>Two properties get most of the attention here, because both are easy to get subtly wrong:
 * <ul>
 *   <li><strong>Rounding is always UP</strong>, through pack size then order multiple then minimum
 *       order. Rounding down lands the delivery already below par, which is exactly the situation
 *       this list exists to prevent.</li>
 *   <li><strong>Ambiguity is reported, never guessed.</strong> Two suppliers with no preference, or
 *       a catalogue row with no current price, produce a row carrying a reason. A suggestion
 *       someone will act on without checking has to be one the system can justify.</li>
 * </ul>
 */
class OrderSuggestionIT extends PurchasingTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired VendorRepository vendorRepository;
    @Autowired VendorItemRepository vendorItemRepository;
    @Autowired VendorItemPriceRepository vendorItemPriceRepository;

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
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
    }

    // ---- fixtures ----

    private RequestPostProcessor asUser(String... authorities) {
        List<GrantedAuthority> granted = List.of(authorities).stream()
                .<GrantedAuthority>map(SimpleGrantedAuthority::new)
                .toList();
        var authentication = new UsernamePasswordAuthenticationToken(
                new JwtClaims(UUID.randomUUID(), tenantId, branchId, List.of(),
                        List.of(authorities), Map.of(), null),
                null, granted);
        return SecurityMockMvcRequestPostProcessors.authentication(authentication);
    }

    private UUID seedVendor(String name) {
        Vendor vendor = new Vendor();
        vendor.setTenantId(tenantId);
        vendor.setName(name);
        vendor.setPaymentTerms("NET30");
        vendor.setLeadTimeDays(3);
        return vendorRepository.save(vendor).getId();
    }

    /** @param qtyPerOrderUnit how many STOCK units one order unit contains (a 10 kg case = 10) */
    private UUID seedVendorItem(UUID vendorId, UUID ingredientId, String orderUom,
                                 BigDecimal qtyPerOrderUnit, BigDecimal minOrderQty,
                                 BigDecimal orderMultiple, boolean preferred) {
        VendorItem item = new VendorItem();
        item.setTenantId(tenantId);
        item.setVendorId(vendorId);
        item.setIngredientId(ingredientId);
        item.setVendorSku("SKU-" + UUID.randomUUID());
        item.setOrderUom(orderUom);
        item.setPackDescription(qtyPerOrderUnit + "kg case");
        item.setPackQty(qtyPerOrderUnit);
        item.setPackUom("kg");
        item.setQtyPerOrderUnitInStockUom(qtyPerOrderUnit);
        item.setMinOrderQty(minOrderQty);
        item.setOrderMultiple(orderMultiple);
        item.setPreferred(preferred);
        return vendorItemRepository.save(item).getId();
    }

    private void seedPrice(UUID vendorItemId, long unitPricePaisa) {
        VendorItemPrice price = new VendorItemPrice();
        price.setTenantId(tenantId);
        price.setVendorItemId(vendorItemId);
        price.setBranchId(null);
        price.setUnitPricePaisa(unitPricePaisa);
        price.setPriceUom("CASE");
        price.setEffectiveFrom(Instant.now().minus(1, ChronoUnit.DAYS));
        price.setEffectiveTo(null);
        vendorItemPriceRepository.save(price);
    }

    private void stubShortfalls(ReorderShortfall... shortfalls) {
        when(inventoryReorderClient.getShortfalls(any()))
                .thenReturn(new InventoryReorderClient.ReorderShortfallsResponse(
                        branchId, List.of(shortfalls), 0));
    }

    private ReorderShortfall shortfall(UUID ingredientId, String name, String onHand,
                                        String reorderPoint, String par, String suggested,
                                        String blockedReason) {
        return new ReorderShortfall(ingredientId, name, "ING-" + name, "kg", UUID.randomUUID(),
                "Produce", new BigDecimal(onHand), new BigDecimal(reorderPoint), new BigDecimal(par),
                suggested == null ? null : new BigDecimal(suggested), blockedReason);
    }

    private JsonNode getSuggestions() throws Exception {
        MvcResult result = mockMvc.perform(
                        MockMvcRequestBuilders.get("/api/v1/purchasing/order-suggestions")
                                .param("branchId", branchId.toString())
                                .with(asUser("vendor.view")))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    }

    // ---- the quantity ----

    @Test
    void aShortfallIsConvertedIntoWholePacksRoundedUp() throws Exception {
        UUID vendorId = seedVendor("Fresh Foods");
        UUID ingredientId = UUID.randomUUID();
        UUID vendorItemId = seedVendorItem(vendorId, ingredientId, "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, true);
        seedPrice(vendorItemId, 90_000L);
        stubShortfalls(shortfall(ingredientId, "Chicken", "4", "10", "25", "21", null));

        JsonNode line = getSuggestions().get("vendorGroups").get(0).get("lines").get(0);

        // 21 kg short, 10 kg per case -> 2.1 cases -> 3. Two cases would land 1 kg below par on
        // delivery day, so the ceiling is the only safe direction.
        assertThat(line.get("orderQty").asInt()).isEqualTo(3);
        assertThat(line.get("shortfallQty").asInt()).isEqualTo(21);
        assertThat(line.get("stockUom").asText()).isEqualTo("kg");
        assertThat(line.get("orderUom").asText()).isEqualTo("CASE");
        assertThat(line.get("lineTotalPaisa").asLong()).isEqualTo(270_000L);
    }

    @Test
    void anOrderMultipleRoundsUpAgainAfterPackSize() throws Exception {
        UUID vendorId = seedVendor("Fresh Foods");
        UUID ingredientId = UUID.randomUUID();
        // 5 kg per case, sold in sixes.
        UUID vendorItemId = seedVendorItem(vendorId, ingredientId, "CASE",
                BigDecimal.valueOf(5), BigDecimal.ONE, BigDecimal.valueOf(6), true);
        seedPrice(vendorItemId, 25_000L);
        stubShortfalls(shortfall(ingredientId, "Tomatoes", "2", "8", "20", "18", null));

        // 18 kg / 5 = 3.6 -> 4 cases -> next multiple of six -> 6.
        assertThat(getSuggestions().get("vendorGroups").get(0).get("lines").get(0)
                .get("orderQty").asInt()).isEqualTo(6);
    }

    @Test
    void aMinimumOrderQuantityIsAFloorAppliedLast() throws Exception {
        UUID vendorId = seedVendor("Fresh Foods");
        UUID ingredientId = UUID.randomUUID();
        UUID vendorItemId = seedVendorItem(vendorId, ingredientId, "CASE",
                BigDecimal.TEN, BigDecimal.valueOf(5), BigDecimal.ONE, true);
        seedPrice(vendorItemId, 90_000L);
        stubShortfalls(shortfall(ingredientId, "Chicken", "9", "10", "12", "3", null));

        // 3 kg short is well under one case, but the supplier will not ship fewer than 5.
        assertThat(getSuggestions().get("vendorGroups").get(0).get("lines").get(0)
                .get("orderQty").asInt()).isEqualTo(5);
    }

    @Test
    void anItemWithNoRecordedPackConversionIsOrderedInItsStockUnit() throws Exception {
        UUID vendorId = seedVendor("Fresh Foods");
        UUID ingredientId = UUID.randomUUID();
        VendorItem item = new VendorItem();
        item.setTenantId(tenantId);
        item.setVendorId(vendorId);
        item.setIngredientId(ingredientId);
        item.setOrderUom("kg");
        item.setPackQty(BigDecimal.ONE);
        item.setPackUom("kg");
        item.setQtyPerOrderUnitInStockUom(null);
        item.setPreferred(true);
        UUID vendorItemId = vendorItemRepository.save(item).getId();
        seedPrice(vendorItemId, 1_000L);
        stubShortfalls(shortfall(ingredientId, "Salt", "1", "5", "16", "15", null));

        // "Order 15 kg" beats "we can't tell you" — a missing conversion means the order unit is
        // the stock unit, not that the row is unanswerable.
        assertThat(getSuggestions().get("vendorGroups").get(0).get("lines").get(0)
                .get("orderQty").asInt()).isEqualTo(15);
    }

    // ---- ambiguity is reported, not guessed ----

    @Test
    void theItemWithNoSupplierIsListedWithAReasonRatherThanDropped() throws Exception {
        UUID ingredientId = UUID.randomUUID();
        stubShortfalls(shortfall(ingredientId, "Saffron", "0", "2", "5", "5", null));

        JsonNode data = getSuggestions();

        assertThat(data.get("vendorGroups")).isEmpty();
        assertThat(data.get("blockedCount").asInt()).isEqualTo(1);
        assertThat(data.get("unassigned").get(0).get("blockedReason").asText())
                .contains("No supplier set up");
    }

    @Test
    void twoSuppliersWithNoPreferenceIsHandedBackNotDecided() throws Exception {
        UUID ingredientId = UUID.randomUUID();
        UUID a = seedVendorItem(seedVendor("Alpha"), ingredientId, "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, false);
        UUID b = seedVendorItem(seedVendor("Beta"), ingredientId, "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, false);
        seedPrice(a, 90_000L);
        seedPrice(b, 80_000L);
        stubShortfalls(shortfall(ingredientId, "Chicken", "4", "10", "25", "21", null));

        // Picking the cheaper one would look clever and be wrong: price is not the only reason a
        // buyer prefers a supplier, and this list is acted on without re-checking.
        JsonNode data = getSuggestions();
        assertThat(data.get("vendorGroups")).isEmpty();
        assertThat(data.get("unassigned").get(0).get("blockedReason").asText())
                .contains("none is marked preferred");
    }

    @Test
    void oneSupplierIsUnambiguousEvenWithoutBeingMarkedPreferred() throws Exception {
        UUID ingredientId = UUID.randomUUID();
        UUID vendorItemId = seedVendorItem(seedVendor("Alpha"), ingredientId, "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, false);
        seedPrice(vendorItemId, 90_000L);
        stubShortfalls(shortfall(ingredientId, "Chicken", "4", "10", "25", "21", null));

        assertThat(getSuggestions().get("vendorGroups")).hasSize(1);
    }

    @Test
    void thePreferredSupplierWinsOverTheCheaperOne() throws Exception {
        UUID ingredientId = UUID.randomUUID();
        UUID preferredVendor = seedVendor("Alpha");
        UUID preferredItem = seedVendorItem(preferredVendor, ingredientId, "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, true);
        UUID cheaperItem = seedVendorItem(seedVendor("Beta"), ingredientId, "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, false);
        seedPrice(preferredItem, 90_000L);
        seedPrice(cheaperItem, 10_000L);
        stubShortfalls(shortfall(ingredientId, "Chicken", "4", "10", "25", "21", null));

        JsonNode groups = getSuggestions().get("vendorGroups");
        assertThat(groups).hasSize(1);
        assertThat(groups.get(0).get("vendorId").asText()).isEqualTo(preferredVendor.toString());
    }

    @Test
    void aCatalogueRowWithNoCurrentPriceCannotBeCosted() throws Exception {
        UUID ingredientId = UUID.randomUUID();
        seedVendorItem(seedVendor("Alpha"), ingredientId, "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, true);
        stubShortfalls(shortfall(ingredientId, "Chicken", "4", "10", "25", "21", null));

        assertThat(getSuggestions().get("unassigned").get(0).get("blockedReason").asText())
                .contains("no current price");
    }

    @Test
    void anUpstreamBlockTravelsThroughUnchanged() throws Exception {
        UUID ingredientId = UUID.randomUUID();
        UUID vendorItemId = seedVendorItem(seedVendor("Alpha"), ingredientId, "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, true);
        seedPrice(vendorItemId, 90_000L);
        stubShortfalls(shortfall(ingredientId, "Cumin", "2", "10", "0", null,
                "No par level set, so there is no target to order up to."));

        // Re-deciding it here would put two explanations of one row in two services.
        assertThat(getSuggestions().get("unassigned").get(0).get("blockedReason").asText())
                .isEqualTo("No par level set, so there is no target to order up to.");
    }

    // ---- grouping and drafts ----

    @Test
    void suggestionsAreGroupedOnePerSupplier() throws Exception {
        UUID alphaVendor = seedVendor("Alpha");
        UUID betaVendor = seedVendor("Beta");
        UUID chickenId = UUID.randomUUID();
        UUID tomatoId = UUID.randomUUID();
        seedPrice(seedVendorItem(alphaVendor, chickenId, "CASE", BigDecimal.TEN, BigDecimal.ONE,
                BigDecimal.ONE, true), 90_000L);
        seedPrice(seedVendorItem(betaVendor, tomatoId, "CASE", BigDecimal.valueOf(5), BigDecimal.ONE,
                BigDecimal.ONE, true), 25_000L);
        stubShortfalls(
                shortfall(chickenId, "Chicken", "4", "10", "25", "21", null),
                shortfall(tomatoId, "Tomatoes", "2", "8", "20", "18", null));

        JsonNode groups = getSuggestions().get("vendorGroups");

        // A purchase order goes to exactly one supplier, so the grouping on screen IS the grouping
        // that gets created. Alphabetical by vendor name.
        assertThat(groups).hasSize(2);
        assertThat(groups.get(0).get("vendorName").asText()).isEqualTo("Alpha");
        assertThat(groups.get(1).get("vendorName").asText()).isEqualTo("Beta");
    }

    @Test
    void acceptedLinesBecomeOneDraftPerSupplier() throws Exception {
        UUID alphaVendor = seedVendor("Alpha");
        UUID betaVendor = seedVendor("Beta");
        UUID alphaItem = seedVendorItem(alphaVendor, UUID.randomUUID(), "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, true);
        UUID betaItem = seedVendorItem(betaVendor, UUID.randomUUID(), "CASE",
                BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE, true);
        seedPrice(alphaItem, 90_000L);
        seedPrice(betaItem, 25_000L);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("branchId", branchId.toString());
        body.put("lines", List.of(
                Map.of("vendorItemId", alphaItem.toString(), "qty", 3),
                Map.of("vendorItemId", betaItem.toString(), "qty", 6)));

        MvcResult result = mockMvc.perform(
                        MockMvcRequestBuilders.post("/api/v1/purchasing/order-suggestions/drafts")
                                .with(asUser("vendor.po.create"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode drafts = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
        assertThat(drafts).hasSize(2);
        for (JsonNode draft : drafts) {
            // DRAFT, never submitted: a suggestion is a starting point for a buyer, not an
            // authority to spend. The existing approval flow is untouched.
            assertThat(draft.get("status").asText()).isEqualTo("DRAFT");
            assertThat(draft.get("lines")).hasSize(1);
        }
        // Prices come from the catalogue, exactly as a hand-typed catalog line would: 3 x 90000.
        assertThat(drafts.get(0).get("totalPaisa").asLong()).isEqualTo(270_000L);
    }

    @Test
    void aForeignCatalogueIdIsRefusedWhenCreatingDrafts() throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("branchId", branchId.toString());
        body.put("lines", List.of(Map.of("vendorItemId", UUID.randomUUID().toString(), "qty", 1)));

        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/order-suggestions/drafts")
                        .with(asUser("vendor.po.create"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void readingSuggestionsNeedsVendorViewAndCreatingDraftsNeedsPoCreate() throws Exception {
        stubShortfalls();

        mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/purchasing/order-suggestions")
                        .param("branchId", branchId.toString())
                        .with(asUser("something.else")))
                .andExpect(status().isForbidden());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("branchId", branchId.toString());
        body.put("lines", List.of());

        // vendor.view alone must not be able to create purchase orders.
        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/order-suggestions/drafts")
                        .with(asUser("vendor.view"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isForbidden());
    }

    @Test
    void inventoryBeingUnreachableIsA503NotAnEmptyList() throws Exception {
        when(inventoryReorderClient.getShortfalls(any()))
                .thenThrow(new IllegalStateException("connection refused"));

        // An empty list would read as "nothing needs ordering" — the most dangerous possible
        // wrong answer for this screen to give.
        mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/purchasing/order-suggestions")
                        .param("branchId", branchId.toString())
                        .with(asUser("vendor.view")))
                .andExpect(status().isServiceUnavailable());
    }
}
