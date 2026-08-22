package io.restaurantos.purchasing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorItem;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Full MockMvc round-trip coverage for the vendor item catalog API (PUR-07): create/list/archive,
 * duplicate-SKU rejection, multi-pack-size cardinality, tenant isolation, and the
 * filter-only/never-authorizes guarantee on category tags. Every request runs through the real
 * {@code @EnableMethodSecurity} interceptor (see {@link PurchasingEndpointAuthorizationIT}'s
 * class javadoc for why {@code SecurityMockMvcRequestPostProcessors.authentication(...)} still
 * exercises it) — there is no {@code TestPrincipal} helper in this module, so the authenticated
 * principal is built inline exactly as {@code PurchasingEndpointAuthorizationIT} does.
 */
class VendorItemCatalogIT extends PurchasingTestBase {

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private TenantContext tenantContext;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private VendorItemRepository vendorItemRepository;

    @Autowired
    private ObjectMapper objectMapper;

    private MockMvc mockMvc;
    private UUID tenantId;
    private UUID branchId;
    private UUID userId;
    private UUID vendorId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        userId = UUID.randomUUID();
        // Seeds the tenant for the direct-repository fixtures below (seedVendor, and the
        // repository assertions in catalogIsScopedToTheCallersTenant). It does NOT survive an
        // HTTP request — see asUser(...) for why every request re-establishes it.
        tenantContext.set(tenantId, branchId, userId, null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
        vendorId = seedVendor(tenantId);
    }

    private UUID seedVendor(UUID tenant) {
        Vendor vendor = new Vendor();
        vendor.setTenantId(tenant);
        vendor.setName("Vendor " + UUID.randomUUID());
        vendor.setPaymentTerms("NET30");
        return vendorRepository.save(vendor).getId();
    }

    /**
     * An authenticated principal AND the tenant binding that principal implies — both, because in
     * production both come from the same place and neither survives on its own here.
     *
     * <p>{@code JwtAuthenticationFilter} is what populates {@code TenantContext} on a live request,
     * from the Bearer token, and it clears the ThreadLocal in a {@code finally} on the way out of
     * EVERY request — including the no-Bearer-token path a MockMvc request takes (that clear is
     * deliberate: skipping it once leaked one tenant's data to the next request on the same worker
     * thread). {@code SecurityMockMvcRequestPostProcessors.authentication(...)} populates the
     * SecurityContext only, so a tenant seeded once in {@code @BeforeEach} is gone the moment the
     * first request completes: request #1 in a test method succeeded and request #2 onwards hit
     * {@code FeatureFlagAspect}'s {@code requireTenantId()} and 500'd. Every test here that made a
     * second successful call was red for exactly that reason.
     *
     * <p>Post-processors run on the test thread before the filter chain, so re-establishing the
     * context here mirrors what the real filter does per request rather than relying on leftover
     * ThreadLocal state. The claims carry the SAME tenant and branch as the context, as a real
     * token would — they were unrelated random UUIDs before.
     */
    private RequestPostProcessor asUser(String... authorities) {
        List<GrantedAuthority> granted = List.of(authorities).stream()
                .<GrantedAuthority>map(SimpleGrantedAuthority::new)
                .toList();
        var claims = new JwtClaims(userId, tenantId, branchId,
                List.of(), List.of(authorities), Map.of(), null);
        RequestPostProcessor authenticated = SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, granted));
        return request -> {
            tenantContext.set(claims.tenantId(), claims.branchId(), claims.subject(), null);
            return authenticated.postProcessRequest(request);
        };
    }

    private Map<String, Object> baseItemBody(String vendorSku) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ingredientId", UUID.randomUUID().toString());
        body.put("vendorSku", vendorSku);
        body.put("vendorDescription", "Tomatoes 5kg case");
        body.put("orderUom", "CASE");
        body.put("packDescription", "5kg case");
        body.put("packQty", 5);
        body.put("packUom", "kg");
        body.put("minOrderQty", 1);
        body.put("orderMultiple", 1);
        body.put("leadTimeDays", 2);
        return body;
    }

    private MvcResult postItem(UUID vendor, Map<String, Object> body) throws Exception {
        return mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendor + "/items")
                        .with(asUser("vendor.manage"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();
    }

    private JsonNode listItems(UUID vendor) throws Exception {
        MvcResult result = mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/purchasing/vendors/" + vendor + "/items")
                        .with(asUser("vendor.view")))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    }

    @Test
    void managerCanCreateAndListCatalogItems() throws Exception {
        postItem(vendorId, baseItemBody("SKU-1")).getResponse();
        postItem(vendorId, baseItemBody("SKU-2")).getResponse();

        JsonNode data = listItems(vendorId);
        assertThat(data).hasSize(2);
        for (JsonNode node : data) {
            assertThat(node.get("packDescription").asText()).isEqualTo("5kg case");
            assertThat(node.get("orderUom").asText()).isEqualTo("CASE");
            assertThat(node.get("minOrderQty").asDouble()).isEqualTo(1.0);
            assertThat(node.get("leadTimeDays").asInt()).isEqualTo(2);
        }
    }

    @Test
    void catalogItemCreatedWithAnInitialPriceExposesItAsCurrentPrice() throws Exception {
        Map<String, Object> body = baseItemBody("SKU-PRICE");
        body.put("initialUnitPricePaisa", 15_000);
        body.put("initialPriceUom", "CASE");

        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendorId + "/items")
                        .with(asUser("vendor.manage"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk());

        JsonNode data = listItems(vendorId);
        assertThat(data).hasSize(1);
        JsonNode created = data.get(0);
        assertThat(created.get("currentUnitPricePaisa").asLong()).isEqualTo(15_000L);
        assertThat(created.get("currentPriceEffectiveFrom").asText()).isNotBlank();
    }

    @Test
    void duplicateVendorSkuForTheSameVendorIsRejected() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendorId + "/items")
                        .with(asUser("vendor.manage"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(baseItemBody("SKU-DUP"))))
                .andExpect(status().isOk());

        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendorId + "/items")
                        .with(asUser("vendor.manage"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(baseItemBody("SKU-DUP"))))
                .andExpect(status().isConflict());
    }

    @Test
    void theSameIngredientMayHaveTwoCatalogRowsWithDifferentPackSizes() throws Exception {
        UUID ingredientId = UUID.randomUUID();

        Map<String, Object> small = baseItemBody("SKU-SMALL");
        small.put("ingredientId", ingredientId.toString());
        small.put("packQty", 5);

        Map<String, Object> large = baseItemBody("SKU-LARGE");
        large.put("ingredientId", ingredientId.toString());
        large.put("packQty", 20);

        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendorId + "/items")
                        .with(asUser("vendor.manage")).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(small)))
                .andExpect(status().isOk());
        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendorId + "/items")
                        .with(asUser("vendor.manage")).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(large)))
                .andExpect(status().isOk());

        JsonNode data = listItems(vendorId);
        assertThat(data).hasSize(2);
        assertThat(data).allSatisfy(n -> assertThat(n.get("ingredientId").asText()).isEqualTo(ingredientId.toString()));
    }

    @Test
    void archivingACatalogItemRemovesItFromTheDefaultListButKeepsThePriceHistory() throws Exception {
        Map<String, Object> body = baseItemBody("SKU-ARCHIVE");
        body.put("initialUnitPricePaisa", 5_000);

        MvcResult createResult = mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendorId + "/items")
                        .with(asUser("vendor.manage"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn();
        String itemId = objectMapper.readTree(createResult.getResponse().getContentAsString()).get("data").get("id").asText();

        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendor-items/" + itemId + "/archive")
                        .with(asUser("vendor.manage")))
                .andExpect(status().isOk());

        assertThat(listItems(vendorId)).isEmpty();

        MvcResult pricesResult = mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/purchasing/vendor-items/" + itemId + "/prices")
                        .with(asUser("vendor.view")))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode prices = objectMapper.readTree(pricesResult.getResponse().getContentAsString()).get("data");
        assertThat(prices).isNotEmpty();
    }

    @Test
    void catalogListIssuesABoundedNumberOfQueries() throws Exception {
        // Pin every seeded price to a fixed instant safely in the past. Left unset, the price row
        // is stamped server-side with Instant.now() and the catalog read filters
        // `effectiveFrom <= Instant.now()` — two reads of the WALL clock, which is not monotonic.
        // A backward NTP step between two of the 15 writes puts the rows stamped just before it
        // fractionally ahead of the later read, and those rows resolve to no current price: the
        // observed flake was exactly one middle row (SKU-BOUND-9) null while the 14 either side
        // were priced, with all 15 stamps inside a 93ms window. Pinning removes the dependency on
        // wall-clock ordering entirely; this test is about the query COUNT for a catalog page, so
        // it has no reason to exercise the default now()-stamping path.
        Instant seededPriceEffectiveFrom = Instant.parse("2020-01-01T00:00:00Z");
        for (int i = 0; i < 15; i++) {
            Map<String, Object> body = baseItemBody("SKU-BOUND-" + i);
            body.put("initialUnitPricePaisa", 1_000 + i);
            body.put("initialPriceEffectiveFrom", seededPriceEffectiveFrom.toString());
            mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendorId + "/items")
                            .with(asUser("vendor.manage"))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(body)))
                    .andExpect(status().isOk());
        }

        MvcResult result = mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/purchasing/vendors/" + vendorId + "/items")
                        .with(asUser("vendor.view"))
                        .param("size", "20"))
                .andExpect(status().isOk())
                .andReturn();

        // Current-price resolution for the whole page is ONE call to
        // VendorItemPriceRepository.findCurrentForVendorItems — no per-row query fan-out.
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
        assertThat(data).hasSize(15);
        assertThat(data).allSatisfy(n -> assertThat(n.get("currentUnitPricePaisa").isNull()).isFalse());
        // Proves the pin above is actually honoured. Without this, a renamed or ignored
        // initialPriceEffectiveFrom would silently restore the wall-clock dependency and the
        // flake with it, while this test stayed green.
        assertThat(data).allSatisfy(n -> assertThat(Instant.parse(n.get("currentPriceEffectiveFrom").asText()))
                .isEqualTo(seededPriceEffectiveFrom));
    }

    @Test
    void viewOnlyPrincipalCannotCreateACatalogItem() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendorId + "/items")
                        .with(asUser("vendor.view"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(baseItemBody("SKU-DENIED"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void unauthenticatedIsRejected() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/purchasing/vendors/" + vendorId + "/items"))
                .andExpect(status().isForbidden());
    }

    @Test
    void catalogIsScopedToTheCallersTenant() {
        UUID otherTenantId = UUID.randomUUID();
        VendorItem otherTenantItem = new VendorItem();
        otherTenantItem.setTenantId(otherTenantId);
        otherTenantItem.setVendorId(vendorId);
        otherTenantItem.setIngredientId(UUID.randomUUID());
        otherTenantItem.setVendorSku("OTHER-TENANT-SKU");
        otherTenantItem.setOrderUom("CASE");
        otherTenantItem.setPackQty(BigDecimal.ONE);
        otherTenantItem.setPackUom("kg");
        vendorItemRepository.save(otherTenantItem);

        List<VendorItem> visible = vendorItemRepository.findByTenantIdAndVendorIdAndArchivedAtIsNull(tenantId, vendorId);
        assertThat(visible).extracting(VendorItem::getVendorSku).doesNotContain("OTHER-TENANT-SKU");
    }

    @Test
    void vendorCategoryTagsAreReadableAndWritableAndAffectNoAuthorization() throws Exception {
        UUID categoryId = UUID.randomUUID();
        List<Map<String, Object>> categories = List.of(Map.of(
                "categoryId", categoryId.toString(),
                "categoryName", "Produce",
                "preferred", true));

        mockMvc.perform(MockMvcRequestBuilders.put("/api/v1/purchasing/vendors/" + vendorId + "/categories")
                        .with(asUser("vendor.manage"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(categories)))
                .andExpect(status().isOk());

        MvcResult getResult = mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/purchasing/vendors/" + vendorId + "/categories")
                        .with(asUser("vendor.view")))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode tags = objectMapper.readTree(getResult.getResponse().getContentAsString()).get("data");
        assertThat(tags).hasSize(1);
        assertThat(tags.get(0).get("categoryName").asText()).isEqualTo("Produce");

        // An ingredient with no relationship at all to the vendor's tag set above must still be
        // catalogable — category tags filter pickers, they never gate a purchase.
        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors/" + vendorId + "/items")
                        .with(asUser("vendor.manage"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(baseItemBody("SKU-UNTAGGED"))))
                .andExpect(status().isOk());
    }
}
