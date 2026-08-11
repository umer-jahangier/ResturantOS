package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.dto.TransferDtos.CreateTransferRequest;
import io.restaurantos.inventory.dto.TransferDtos.ReceiveLineRequest;
import io.restaurantos.inventory.dto.TransferDtos.ReceiveTransferRequest;
import io.restaurantos.inventory.dto.TransferDtos.TransferLineRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.service.TransferService;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T-8-AC: {@code TransferController} enforces {@code inventory.item.manage} via
 * {@code InventoryAuthorizationService} on BOTH {@code POST /ship} and {@code POST /receive}. A
 * JWT carrying only {@code inventory.item.view} is denied 403 on both endpoints with no
 * TRANSFER_OUT/TRANSFER_IN movement written; an INVENTORY_MANAGER JWT succeeds on both.
 */
class TransferAccessControlIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired InventoryMovementRepository movementRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TransferService transferService;

    @MockitoBean FeatureFlagService featureFlagService;

    MockMvc mockMvc;
    UUID tenantId;
    UUID fromBranchId;
    UUID toBranchId;
    UUID ingredientId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                // Binds TenantContext per REQUEST from the authenticated principal, the way
                // JwtAuthenticationFilter does in production. Without it every perform() after the
                // first runs with no tenant: the production filter clears on the way out, and it is
                // right to. See TenantContextBindingTestFilter.
                .addFilter(TenantContextBindingTestFilter.from(webApplicationContext), "/*")
                .build();
        tenantId = UUID.randomUUID();
        fromBranchId = UUID.randomUUID();
        toBranchId = UUID.randomUUID();
        tenantContext.set(tenantId, fromBranchId, null, null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);

        ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Beef Mince", "SKU-AC-XFER-001", "KG", BigDecimal.ZERO).getId();
        InventoryFixtures.seedStock(stockRepository, tenantId, fromBranchId, ingredientId,
                BigDecimal.valueOf(50), 400L);
    }

    private RequestPostProcessor asInventoryManager() {
        return asInventoryManagerAtBranch(fromBranchId);
    }

    private RequestPostProcessor asInventoryManagerAtBranch(UUID branchId) {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("INVENTORY_MANAGER"),
                List.of("inventory.item.view", "inventory.item.manage"), Map.of(), null);
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private RequestPostProcessor asViewOnly() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, fromBranchId,
                List.of("MANAGER"), List.of("inventory.item.view"), Map.of(), null);
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    @Test
    void viewOnlyPrincipal_isDeniedOnShip_andNoTransferOutMovementWritten() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        CreateTransferRequest request = new CreateTransferRequest(
                fromBranchId, toBranchId, List.of(new TransferLineRequest(ingredientId, BigDecimal.TEN)));

        mockMvc.perform(post("/api/v1/inventory/transfers/ship")
                        .with(asViewOnly())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());

        long transferOutCount = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId) && "TRANSFER_OUT".equals(m.getMovementType()))
                .count();
        assertThat(transferOutCount).isZero();

        // Scoped by tenantId (unique per test) AND eventType — event_outbox has no RLS and
        // InventoryTestBase's Flyway clean() runs once per test CLASS, not per method, so an
        // eventType-only filter would leak counts across sibling test methods in this class that
        // also publish TRANSFER_SHIPPED (e.g. inventoryManager_succeedsOnShipAndReceive).
        long shippedOutboxCount = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "TRANSFER_SHIPPED".equals(e.getEventType())).count();
        assertThat(shippedOutboxCount).isZero();
    }

    @Test
    void viewOnlyPrincipal_isDeniedOnReceive_andNoTransferInMovementWritten() throws Exception {
        // Seed a real SHIPPED transfer (bean-level, bypassing the controller) so /receive has a
        // valid transferId to attempt against — proves the OPA denial fires before any mutation,
        // not that the transferId lookup itself fails.
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));
        var shipped = transferService.ship(new CreateTransferRequest(
                fromBranchId, toBranchId, List.of(new TransferLineRequest(ingredientId, BigDecimal.TEN))));

        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));
        ReceiveTransferRequest request = new ReceiveTransferRequest(
                shipped.transferId(), List.of(new ReceiveLineRequest(ingredientId, BigDecimal.TEN)));

        mockMvc.perform(post("/api/v1/inventory/transfers/receive")
                        .with(asViewOnly())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());

        long transferInCount = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId) && "TRANSFER_IN".equals(m.getMovementType()))
                .count();
        assertThat(transferInCount).isZero();

        long receivedOutboxCount = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "TRANSFER_RECEIVED".equals(e.getEventType())).count();
        assertThat(receivedOutboxCount).isZero();
    }

    @Test
    void inventoryManager_succeedsOnShipAndReceive() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        CreateTransferRequest shipRequest = new CreateTransferRequest(
                fromBranchId, toBranchId, List.of(new TransferLineRequest(ingredientId, BigDecimal.TEN)));

        String shipResponseJson = mockMvc.perform(post("/api/v1/inventory/transfers/ship")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(shipRequest)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        UUID transferId = UUID.fromString(
                objectMapper.readTree(shipResponseJson).path("data").path("transferId").asText());

        ReceiveTransferRequest receiveRequest = new ReceiveTransferRequest(
                transferId, List.of(new ReceiveLineRequest(ingredientId, BigDecimal.TEN)));

        // Receive is performed by a manager AT THE DESTINATION branch (toBranchId) — the caller
        // may only receive into their own branch (CR-1). Shipping manager is at fromBranchId.
        mockMvc.perform(post("/api/v1/inventory/transfers/receive")
                        .with(asInventoryManagerAtBranch(toBranchId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(receiveRequest)))
                .andExpect(status().isOk());
    }

    /**
     * 08.2 code-review CR-1: an inventory.item.manage holder at Branch A may not ship stock OUT of a
     * different branch. OPA grants inventory.item.manage (permission passes); the controller's
     * branch-ownership guard must still 403 because request.fromBranchId != caller's own branch, and
     * no TRANSFER_OUT movement is written.
     */
    @Test
    void managerAtOwnBranch_cannotShipFromAnotherBranch() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));
        UUID otherSourceBranchId = UUID.randomUUID();

        CreateTransferRequest request = new CreateTransferRequest(
                otherSourceBranchId, toBranchId, List.of(new TransferLineRequest(ingredientId, BigDecimal.TEN)));

        mockMvc.perform(post("/api/v1/inventory/transfers/ship")
                        .with(asInventoryManagerAtBranch(fromBranchId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());

        // Scoped by this test's per-method ingredientId — InventoryTestBase.clean() runs once per
        // test CLASS, so sibling methods' TRANSFER_OUT rows (their own ingredientIds) would
        // otherwise be counted here.
        long transferOutCount = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId) && "TRANSFER_OUT".equals(m.getMovementType()))
                .count();
        assertThat(transferOutCount).isZero();

        long shippedOutboxCount = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "TRANSFER_SHIPPED".equals(e.getEventType())).count();
        assertThat(shippedOutboxCount).isZero();
    }

    /**
     * 08.2 code-review CR-1: an inventory.item.manage holder whose own branch is NOT the transfer's
     * destination may not receive it. OPA grants the permission; the service's destination-branch
     * guard must 403 before any TRANSFER_IN movement is written, even against a real SHIPPED
     * transfer.
     */
    @Test
    void managerAtNonDestinationBranch_cannotReceive() throws Exception {
        // Seed a real SHIPPED transfer fromBranchId -> toBranchId (bean-level).
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));
        var shipped = transferService.ship(new CreateTransferRequest(
                fromBranchId, toBranchId, List.of(new TransferLineRequest(ingredientId, BigDecimal.TEN))));

        // A manager at fromBranchId (NOT the destination toBranchId) attempts to receive it.
        ReceiveTransferRequest request = new ReceiveTransferRequest(
                shipped.transferId(), List.of(new ReceiveLineRequest(ingredientId, BigDecimal.TEN)));

        mockMvc.perform(post("/api/v1/inventory/transfers/receive")
                        .with(asInventoryManagerAtBranch(fromBranchId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());

        long transferInCount = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId) && "TRANSFER_IN".equals(m.getMovementType()))
                .count();
        assertThat(transferInCount).isZero();

        long receivedOutboxCount = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "TRANSFER_RECEIVED".equals(e.getEventType())).count();
        assertThat(receivedOutboxCount).isZero();
    }

    /**
     * 08.2-17: GET /pending is gated on inventory.item.view AND own-branch only — a caller cannot
     * list another branch's in-transit transfers by passing a foreign branchId query param. (Closes
     * the verification report's noted test-coverage gap for the pending-transfers read path.)
     */
    @Test
    void managerCannotListAnotherBranchesPendingTransfers() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        mockMvc.perform(get("/api/v1/inventory/transfers/pending")
                        .param("branchId", toBranchId.toString())
                        .with(asInventoryManagerAtBranch(fromBranchId)))
                .andExpect(status().isForbidden());
    }

    @Test
    void managerListsOwnBranchesPendingTransfers() throws Exception {
        // Seed a real SHIPPED transfer fromBranchId -> toBranchId (bean-level), then list it as the
        // destination-branch manager.
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));
        transferService.ship(new CreateTransferRequest(
                fromBranchId, toBranchId, List.of(new TransferLineRequest(ingredientId, BigDecimal.TEN))));

        mockMvc.perform(get("/api/v1/inventory/transfers/pending")
                        .param("branchId", toBranchId.toString())
                        .with(asInventoryManagerAtBranch(toBranchId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].toBranchId").value(toBranchId.toString()))
                .andExpect(jsonPath("$.data[0].status").value("SHIPPED"));
    }
}
