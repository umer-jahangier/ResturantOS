package io.restaurantos.purchasing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorItem;
import io.restaurantos.purchasing.dto.CreateVendorItemRequest;
import io.restaurantos.purchasing.dto.RecordVendorItemPriceRequest;
import io.restaurantos.purchasing.dto.VendorItemDto;
import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorItemRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.VendorItemPriceService;
import io.restaurantos.purchasing.service.VendorItemService;
import io.restaurantos.shared.api.ApiResponse;
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
 * Full MockMvc round-trip coverage for catalog-driven PO lines (PUR-08): server-side derivation
 * of ingredient/uom/price from a vendor's catalog, the cross-vendor and cross-tenant guards, the
 * price-override flag, and the legacy hand-typed-ingredient compatibility contract. Reuses
 * {@code VendorItemCatalogIT}'s inline {@code asUser(...)} authentication builder — there is no
 * shared {@code TestPrincipal} MockMvc helper in this module.
 */
class PurchaseOrderVendorItemIT extends PurchasingTestBase {

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private TenantContext tenantContext;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private VendorItemRepository vendorItemRepository;

    @Autowired
    private VendorItemService vendorItemService;

    @Autowired
    private VendorItemPriceService vendorItemPriceService;

    @Autowired
    private PurchaseOrderRepository purchaseOrderRepository;

    @Autowired
    private ObjectMapper objectMapper;

    private MockMvc mockMvc;
    private UUID tenantId;
    private UUID branchId;
    private UUID vendorId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
        when(authorizationClient.authorize(any())).thenReturn(
                ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));
        vendorId = seedVendor(tenantId);
    }

    private UUID seedVendor(UUID tenant) {
        Vendor vendor = new Vendor();
        vendor.setTenantId(tenant);
        vendor.setName("Vendor " + UUID.randomUUID());
        vendor.setPaymentTerms("NET30");
        return vendorRepository.save(vendor).getId();
    }

    private VendorItemDto seedCatalogItem(UUID vendor, long initialUnitPricePaisa) {
        return vendorItemService.create(vendor, new CreateVendorItemRequest(
                UUID.randomUUID(), "SKU-" + UUID.randomUUID(), "Tomatoes 5kg case", null,
                "CASE", "5kg case", BigDecimal.valueOf(5), "kg",
                BigDecimal.ONE, BigDecimal.ONE, 2, false, false,
                initialUnitPricePaisa, "CASE", null));
    }

    private static RequestPostProcessor asUser(String... authorities) {
        List<GrantedAuthority> granted = List.of(authorities).stream()
                .<GrantedAuthority>map(SimpleGrantedAuthority::new)
                .toList();
        var authentication = new UsernamePasswordAuthenticationToken(
                new JwtClaims(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                        List.of(), List.of(authorities), Map.of(), null),
                null, granted);
        return SecurityMockMvcRequestPostProcessors.authentication(authentication);
    }

    private Map<String, Object> catalogLine(UUID vendorItemId, Object qty, Long unitPricePaisa) {
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("vendorItemId", vendorItemId.toString());
        line.put("qty", qty);
        if (unitPricePaisa != null) {
            line.put("unitPricePaisa", unitPricePaisa);
        }
        return line;
    }

    private Map<String, Object> legacyLine(UUID ingredientId, Object qty, String uom, long unitPricePaisa) {
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("ingredientId", ingredientId.toString());
        line.put("qty", qty);
        line.put("uom", uom);
        line.put("unitPricePaisa", unitPricePaisa);
        return line;
    }

    private Map<String, Object> createPoBody(UUID vendor, List<Map<String, Object>> lines) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("vendorId", vendor.toString());
        body.put("branchId", branchId.toString());
        body.put("lines", lines);
        return body;
    }

    private MvcResult postCreatePo(Map<String, Object> body) throws Exception {
        return mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/purchase-orders")
                        .with(asUser("vendor.po.create"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();
    }

    @Test
    void lineFromCatalogDerivesIngredientUomAndPrice() throws Exception {
        VendorItemDto item = seedCatalogItem(vendorId, 15_000L);

        MvcResult result = postCreatePo(createPoBody(vendorId,
                List.of(catalogLine(item.id(), 3, null))));
        result.getResponse().setCharacterEncoding("UTF-8");
        assertThat(result.getResponse().getStatus()).isEqualTo(200);

        JsonNode line = objectMapper.readTree(result.getResponse().getContentAsString())
                .get("data").get("lines").get(0);
        assertThat(line.get("ingredientId").asText()).isEqualTo(item.ingredientId().toString());
        assertThat(line.get("uom").asText()).isEqualTo("CASE");
        assertThat(line.get("unitPricePaisa").asLong()).isEqualTo(15_000L);
        assertThat(line.get("priceOverridden").asBoolean()).isFalse();
        assertThat(line.get("vendorItemId").asText()).isEqualTo(item.id().toString());
    }

    @Test
    void explicitUnitPriceOverridesTheCatalogPriceAndIsFlagged() throws Exception {
        VendorItemDto item = seedCatalogItem(vendorId, 15_000L);

        MvcResult result = postCreatePo(createPoBody(vendorId,
                List.of(catalogLine(item.id(), 3, 12_000L))));
        assertThat(result.getResponse().getStatus()).isEqualTo(200);

        JsonNode line = objectMapper.readTree(result.getResponse().getContentAsString())
                .get("data").get("lines").get(0);
        assertThat(line.get("unitPricePaisa").asLong()).isEqualTo(12_000L);
        assertThat(line.get("priceOverridden").asBoolean()).isTrue();
    }

    @Test
    void vendorItemFromAnotherVendorIsRejected() throws Exception {
        UUID otherVendorId = seedVendor(tenantId);
        VendorItemDto otherVendorItem = seedCatalogItem(otherVendorId, 10_000L);

        MvcResult result = postCreatePo(createPoBody(vendorId,
                List.of(catalogLine(otherVendorItem.id(), 1, null))));
        assertThat(result.getResponse().getStatus()).isEqualTo(422);

        assertThat(purchaseOrderRepository.findByTenantIdAndVendorIdAndBranchId(tenantId, vendorId, branchId))
                .isEmpty();
    }

    @Test
    void archivedVendorItemIsRejected() throws Exception {
        VendorItemDto item = seedCatalogItem(vendorId, 10_000L);
        vendorItemService.archive(item.id());

        MvcResult result = postCreatePo(createPoBody(vendorId,
                List.of(catalogLine(item.id(), 1, null))));
        assertThat(result.getResponse().getStatus()).isEqualTo(422);
    }

    @Test
    void unknownVendorItemIsRejected() throws Exception {
        MvcResult result = postCreatePo(createPoBody(vendorId,
                List.of(catalogLine(UUID.randomUUID(), 1, null))));
        assertThat(result.getResponse().getStatus()).isEqualTo(422);
    }

    @Test
    void legacyLineWithoutVendorItemIdStillCreates() throws Exception {
        MvcResult result = postCreatePo(createPoBody(vendorId,
                List.of(legacyLine(UUID.randomUUID(), BigDecimal.TEN, "kg", 1000L))));
        assertThat(result.getResponse().getStatus()).isEqualTo(200);

        JsonNode line = objectMapper.readTree(result.getResponse().getContentAsString())
                .get("data").get("lines").get(0);
        assertThat(line.get("vendorItemId").isNull()).isTrue();
        assertThat(line.get("vendorSku").isNull()).isTrue();
        assertThat(line.get("packDescription").isNull()).isTrue();
        assertThat(line.get("priceOverridden").asBoolean()).isFalse();
    }

    @Test
    void lineWithNeitherVendorItemIdNorIngredientIdIsRejected() throws Exception {
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("qty", 1);
        line.put("uom", "kg");
        line.put("unitPricePaisa", 1000L);

        MvcResult result = postCreatePo(createPoBody(vendorId, List.of(line)));
        assertThat(result.getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    void poResponseExposesVendorSkuAndPackDescriptionForCatalogLines() throws Exception {
        VendorItemDto item = seedCatalogItem(vendorId, 10_000L);

        MvcResult result = postCreatePo(createPoBody(vendorId, List.of(
                catalogLine(item.id(), 1, null),
                legacyLine(UUID.randomUUID(), BigDecimal.ONE, "kg", 500L))));
        assertThat(result.getResponse().getStatus()).isEqualTo(200);

        JsonNode lines = objectMapper.readTree(result.getResponse().getContentAsString()).get("data").get("lines");
        JsonNode catalogLineDto = lines.get(0);
        assertThat(catalogLineDto.get("vendorSku").asText()).isEqualTo(item.vendorSku());
        assertThat(catalogLineDto.get("packDescription").asText()).isEqualTo("5kg case");

        JsonNode legacyLineDto = lines.get(1);
        assertThat(legacyLineDto.get("vendorSku").isNull()).isTrue();
        assertThat(legacyLineDto.get("packDescription").isNull()).isTrue();
    }

    @Test
    void catalogItemFromAnotherTenantIsInvisible() throws Exception {
        UUID otherTenantId = UUID.randomUUID();
        VendorItem otherTenantItem = new VendorItem();
        otherTenantItem.setTenantId(otherTenantId);
        otherTenantItem.setVendorId(vendorId);
        otherTenantItem.setIngredientId(UUID.randomUUID());
        otherTenantItem.setVendorSku("OTHER-TENANT-SKU");
        otherTenantItem.setOrderUom("CASE");
        otherTenantItem.setPackQty(BigDecimal.ONE);
        otherTenantItem.setPackUom("kg");
        VendorItem saved = vendorItemRepository.save(otherTenantItem);

        MvcResult result = postCreatePo(createPoBody(vendorId,
                List.of(catalogLine(saved.getId(), 1, 1000L))));
        assertThat(result.getResponse().getStatus()).isEqualTo(422);
    }

    @Test
    void priceUsedIsTheOneEffectiveAtOrderTime() throws Exception {
        Instant past = Instant.now().minus(10, ChronoUnit.DAYS);
        Instant future = Instant.now().plus(10, ChronoUnit.DAYS);

        VendorItemDto item = vendorItemService.create(vendorId, new CreateVendorItemRequest(
                UUID.randomUUID(), "SKU-" + UUID.randomUUID(), "Tomatoes 5kg case", null,
                "CASE", "5kg case", BigDecimal.valueOf(5), "kg",
                BigDecimal.ONE, BigDecimal.ONE, 2, false, false,
                8_000L, "CASE", past));

        // A future-dated price row exists, but must NOT be the one picked for a PO created now.
        vendorItemPriceService.recordNewPrice(item.id(), new RecordVendorItemPriceRequest(
                20_000L, "CASE", future, null, false, "CATALOG"));

        MvcResult result = postCreatePo(createPoBody(vendorId,
                List.of(catalogLine(item.id(), 1, null))));
        assertThat(result.getResponse().getStatus()).isEqualTo(200);

        JsonNode line = objectMapper.readTree(result.getResponse().getContentAsString())
                .get("data").get("lines").get(0);
        assertThat(line.get("unitPricePaisa").asLong()).isEqualTo(8_000L);
    }
}
