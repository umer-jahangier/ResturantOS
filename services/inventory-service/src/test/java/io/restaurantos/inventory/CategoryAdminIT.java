package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.CreateItemCategoryRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.MoveItemCategoryRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.UpdateItemCategoryRequest;
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

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Every INV-13 rule (3-level cap, cycle guard, archive-refusal, most-specific-wins GL
 * inheritance) proven through real HTTP dispatch against {@code /api/v1/inventory/categories}.
 */
class CategoryAdminIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;

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

    private JsonNode createCategory(CreateItemCategoryRequest request) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private JsonNode createIngredient(String name, String sku, UUID categoryId) throws Exception {
        CreateIngredientRequest request = new CreateIngredientRequest(
                name, sku, "KG", categoryId,
                null, null, null, null, null, null, null, null, null, null,
                BigDecimal.TEN, null, null, null);
        MvcResult result = mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    @Test
    void managerCanCreateAThreeLevelTree() throws Exception {
        JsonNode root = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        assertThat(root.path("level").asInt()).isEqualTo(1);

        JsonNode child = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(root.path("id").asText()), "Dairy", null, null, null, null, null, null, null));
        assertThat(child.path("level").asInt()).isEqualTo(2);

        JsonNode grandchild = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(child.path("id").asText()), "Milk", null, null, null, null, null, null, null));
        assertThat(grandchild.path("level").asInt()).isEqualTo(3);
    }

    @Test
    void creatingAFourthLevelIsRejected() throws Exception {
        JsonNode root = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        JsonNode child = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(root.path("id").asText()), "Dairy", null, null, null, null, null, null, null));
        JsonNode grandchild = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(child.path("id").asText()), "Milk", null, null, null, null, null, null, null));

        CreateItemCategoryRequest fourthLevel = new CreateItemCategoryRequest(
                UUID.fromString(grandchild.path("id").asText()), "Whole Milk", null, null, null, null, null, null, null);

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(fourthLevel)))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.error.message").value(org.hamcrest.Matchers.containsString("3 level")));
    }

    @Test
    void treeEndpointReturnsNestedChildren() throws Exception {
        JsonNode root = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        JsonNode child = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(root.path("id").asText()), "Dairy", null, null, null, null, null, null, null));
        createCategory(new CreateItemCategoryRequest(
                UUID.fromString(child.path("id").asText()), "Milk", null, null, null, null, null, null, null));

        MvcResult result = mockMvc.perform(get("/api/v1/inventory/categories/tree").with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode tree = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        assertThat(tree).hasSize(1);
        JsonNode rootNode = tree.get(0);
        assertThat(rootNode.path("children")).hasSize(1);
        JsonNode childNode = rootNode.path("children").get(0);
        assertThat(childNode.path("children")).hasSize(1);
    }

    @Test
    void glAccountsInheritMostSpecificWins() throws Exception {
        JsonNode root = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, "5000-COST", null, null, null, null));
        JsonNode child = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(root.path("id").asText()), "Dairy", null, null, null, null, null, null, null));
        JsonNode grandchild = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(child.path("id").asText()), "Milk", null, null, null, null, null, null, null));

        assertThat(grandchild.path("resolvedGlAccounts").path("costAccountCode").asText()).isEqualTo("5000-COST");
        assertThat(grandchild.path("resolvedGlAccounts").path("costInherited").asBoolean()).isTrue();

        String grandchildId = grandchild.path("id").asText();
        UpdateItemCategoryRequest overrideRequest = new UpdateItemCategoryRequest(
                "Milk", null, null, "6000-COST", null, null, null, null);
        MvcResult updateResult = mockMvc.perform(put("/api/v1/inventory/categories/" + grandchildId)
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(overrideRequest)))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode updated = objectMapper.readTree(updateResult.getResponse().getContentAsString()).path("data");
        assertThat(updated.path("resolvedGlAccounts").path("costAccountCode").asText()).isEqualTo("6000-COST");
        assertThat(updated.path("resolvedGlAccounts").path("costInherited").asBoolean()).isFalse();
    }

    @Test
    void archivingACategoryWithIngredientsIsRefused() throws Exception {
        JsonNode category = createCategory(new CreateItemCategoryRequest(
                null, "Dairy", null, null, null, null, null, null, null));
        createIngredient("Milk", "SKU-MILK-001", UUID.fromString(category.path("id").asText()));

        String id = category.path("id").asText();
        mockMvc.perform(post("/api/v1/inventory/categories/" + id + "/archive").with(asManager()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CATEGORY_IN_USE"))
                .andExpect(jsonPath("$.error.message").value(org.hamcrest.Matchers.containsString("1 ingredient")));
    }

    @Test
    void archivingACategoryWithChildrenIsRefused() throws Exception {
        JsonNode root = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        createCategory(new CreateItemCategoryRequest(
                UUID.fromString(root.path("id").asText()), "Dairy", null, null, null, null, null, null, null));

        String id = root.path("id").asText();
        mockMvc.perform(post("/api/v1/inventory/categories/" + id + "/archive").with(asManager()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CATEGORY_IN_USE"));
    }

    @Test
    void archivingAnEmptyCategorySucceedsAndSetsArchivedAt() throws Exception {
        JsonNode category = createCategory(new CreateItemCategoryRequest(
                null, "Beverages", null, null, null, null, null, null, null));
        String id = category.path("id").asText();

        mockMvc.perform(post("/api/v1/inventory/categories/" + id + "/archive").with(asManager()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.archivedAt").exists());

        MvcResult defaultList = mockMvc.perform(get("/api/v1/inventory/categories").with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode defaultData = objectMapper.readTree(defaultList.getResponse().getContentAsString()).path("data");
        boolean foundInDefault = false;
        for (JsonNode node : defaultData) {
            if (id.equals(node.path("id").asText())) {
                foundInDefault = true;
            }
        }
        assertThat(foundInDefault).as("archived category should not appear in the default list").isFalse();

        MvcResult includeArchivedList = mockMvc.perform(get("/api/v1/inventory/categories")
                        .param("includeArchived", "true")
                        .with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode includeArchivedData = objectMapper.readTree(includeArchivedList.getResponse().getContentAsString()).path("data");
        boolean foundWhenIncluded = false;
        for (JsonNode node : includeArchivedData) {
            if (id.equals(node.path("id").asText())) {
                foundWhenIncluded = true;
            }
        }
        assertThat(foundWhenIncluded).as("includeArchived=true should surface the archived category").isTrue();
    }

    @Test
    void movingANodeUnderItsOwnDescendantIsRejected() throws Exception {
        JsonNode root = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        JsonNode child = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(root.path("id").asText()), "Dairy", null, null, null, null, null, null, null));

        String rootId = root.path("id").asText();
        String childId = child.path("id").asText();

        mockMvc.perform(put("/api/v1/inventory/categories/" + rootId + "/parent")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new MoveItemCategoryRequest(UUID.fromString(childId)))))
                .andExpect(status().is4xxClientError());
    }

    @Test
    void movingASubtreeUpdatesDescendantLevels() throws Exception {
        JsonNode rootA = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        JsonNode childB = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(rootA.path("id").asText()), "Dairy", null, null, null, null, null, null, null));
        JsonNode grandchildC = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(childB.path("id").asText()), "Milk", null, null, null, null, null, null, null));
        JsonNode rootD = createCategory(new CreateItemCategoryRequest(
                null, "Beverages", null, null, null, null, null, null, null));

        String childBId = childB.path("id").asText();
        String rootDId = rootD.path("id").asText();
        String grandchildCId = grandchildC.path("id").asText();

        MvcResult moveResult = mockMvc.perform(put("/api/v1/inventory/categories/" + childBId + "/parent")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new MoveItemCategoryRequest(UUID.fromString(rootDId)))))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode moved = objectMapper.readTree(moveResult.getResponse().getContentAsString()).path("data");
        assertThat(moved.path("level").asInt()).isEqualTo(2);

        MvcResult grandchildResult = mockMvc.perform(get("/api/v1/inventory/categories/" + grandchildCId).with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode grandchildAfterMove = objectMapper.readTree(grandchildResult.getResponse().getContentAsString()).path("data");
        assertThat(grandchildAfterMove.path("level").asInt()).isEqualTo(3);
    }

    // ── uq_item_category_tenant_parent_name (three doors onto the same constraint) ────────────
    //
    // Before this, a name collision on any of create/rename/move reached the DB constraint
    // directly: an unhandled DataIntegrityViolationException, answered with a bare 500. Pins the
    // fix — a 409 naming the actual sibling — rather than the constraint's raw SQLSTATE.

    @Test
    void creatingTwoRootCategoriesWithTheSameNameIsRefusedNotA500() throws Exception {
        createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateItemCategoryRequest(
                                null, "Groceries", null, null, null, null, null, null, null))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CATEGORY_NAME_DUPLICATE"))
                .andExpect(jsonPath("$.error.message").value(org.hamcrest.Matchers.containsString("Groceries")));
    }

    @Test
    void creatingTwoSubcategoriesWithTheSameNameUnderOneParentIsRefused() throws Exception {
        JsonNode root = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        createCategory(new CreateItemCategoryRequest(
                UUID.fromString(root.path("id").asText()), "Dairy", null, null, null, null, null, null, null));

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateItemCategoryRequest(
                                UUID.fromString(root.path("id").asText()), "Dairy",
                                null, null, null, null, null, null, null))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CATEGORY_NAME_DUPLICATE"))
                .andExpect(jsonPath("$.error.message").value("\"Groceries\" already has a subcategory named \"Dairy\"."));
    }

    @Test
    void theSameNameUnderTwoDifferentParentsIsNotAConflict() throws Exception {
        // The constraint is (tenant_id, parent_id, name) — "Dairy" under two different roots is
        // two distinct rows, not a collision. Proves the check is scoped correctly, not just that
        // it exists.
        JsonNode rootA = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        JsonNode rootB = createCategory(new CreateItemCategoryRequest(
                null, "Beverages", null, null, null, null, null, null, null));
        createCategory(new CreateItemCategoryRequest(
                UUID.fromString(rootA.path("id").asText()), "Dairy", null, null, null, null, null, null, null));

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateItemCategoryRequest(
                                UUID.fromString(rootB.path("id").asText()), "Dairy",
                                null, null, null, null, null, null, null))))
                .andExpect(status().isOk());
    }

    @Test
    void renamingACategoryToItsSiblingsNameIsRefused() throws Exception {
        JsonNode root = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        createCategory(new CreateItemCategoryRequest(
                UUID.fromString(root.path("id").asText()), "Dairy", null, null, null, null, null, null, null));
        JsonNode produce = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(root.path("id").asText()), "Produce", null, null, null, null, null, null, null));

        mockMvc.perform(put("/api/v1/inventory/categories/" + produce.path("id").asText())
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new UpdateItemCategoryRequest(
                                "Dairy", null, null, null, null, null, null, null))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CATEGORY_NAME_DUPLICATE"));
    }

    @Test
    void renamingACategoryToItsOwnCurrentNameIsAllowed() throws Exception {
        // The pre-check excludes the row's own id — otherwise every no-op save of an unrelated
        // field (sort order, a GL account) would 409 against itself.
        JsonNode category = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));

        mockMvc.perform(put("/api/v1/inventory/categories/" + category.path("id").asText())
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new UpdateItemCategoryRequest(
                                "Groceries", null, null, null, null, null, null, null))))
                .andExpect(status().isOk());
    }

    @Test
    void recreatingAnArchivedCategorysNameExplainsWhyRatherThanJustSayingItExists() throws Exception {
        // The exact confusion this is pinned against: the default category list hides archived
        // rows entirely, so a bare "already exists" points at something the manager's screen
        // provably does not show — they see nothing named "Refreshment" and are told it exists.
        JsonNode refreshment = createCategory(new CreateItemCategoryRequest(
                null, "Refreshment", null, null, null, null, null, null, null));
        mockMvc.perform(post("/api/v1/inventory/categories/" + refreshment.path("id").asText() + "/archive")
                        .with(asManager()))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateItemCategoryRequest(
                                null, "Refreshment", null, null, null, null, null, null, null))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CATEGORY_NAME_DUPLICATE"))
                .andExpect(jsonPath("$.error.message").value(
                        "A top-level category named \"Refreshment\" already exists, but it's archived. "
                                + "Restore it, or use a different name."));
    }

    @Test
    void movingACategoryUnderAParentThatAlreadyHasThatNameIsRefused() throws Exception {
        JsonNode rootA = createCategory(new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null));
        createCategory(new CreateItemCategoryRequest(
                UUID.fromString(rootA.path("id").asText()), "Dairy", null, null, null, null, null, null, null));
        JsonNode rootB = createCategory(new CreateItemCategoryRequest(
                null, "Beverages", null, null, null, null, null, null, null));
        JsonNode dairyUnderB = createCategory(new CreateItemCategoryRequest(
                UUID.fromString(rootB.path("id").asText()), "Dairy", null, null, null, null, null, null, null));

        // Moving "Dairy" (under Beverages) to become a sibling of the existing "Dairy" under
        // Groceries — same collision create()/update() guard against, reached by re-parenting
        // instead of naming.
        mockMvc.perform(put("/api/v1/inventory/categories/" + dairyUnderB.path("id").asText() + "/parent")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new MoveItemCategoryRequest(UUID.fromString(rootA.path("id").asText())))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CATEGORY_NAME_DUPLICATE"));
    }
}
