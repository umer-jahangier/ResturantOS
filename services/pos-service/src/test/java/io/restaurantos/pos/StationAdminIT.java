package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.CreateStationRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.StationDto;
import io.restaurantos.pos.dto.UpdateStationRequest;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.StationService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Phase 3 — Station Routing Refactor (Stages B + C, pos side):
 *  - station admin CRUD (create/list/update/deactivate) is tenant + branch scoped and enforces
 *    the branch-isolation guard (a foreign branchId is denied)
 *  - menu-item → station assignment validates the station belongs to the caller's branch and
 *    mirrors the canonical code into the retained free-text kds_station
 *  - a fired line snapshots station_id and the ORDER_SENT_TO_KDS event carries the additive
 *    stationId/stationName plus the canonical station code in kdsStation
 */
class StationAdminIT extends PosTestBase {

    @Autowired StationService stationService;
    @Autowired MenuService menuService;
    @Autowired OrderService orderService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID ownBranch;
    UUID foreignBranch;
    UUID cashierId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        ownBranch = UUID.randomUUID();
        foreignBranch = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, ownBranch, cashierId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Chicken Karahi");
        item.setBasePricePaisa(85000L);
        item.setTaxRatePct(new BigDecimal("5.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        // Financial-integrity guard: the two sendToKds tests create orders as the cashier in
        // ownBranch, which now requires an OPEN till for that cashier.
        openTillForCashier(ownBranch);
    }

    @Test
    void createStation_thenList_succeeds() {
        StationDto created = stationService.createStation(ownBranch, new CreateStationRequest("GRILL", "Grill Line"));
        assertThat(created.id()).isNotNull();
        assertThat(created.code()).isEqualTo("GRILL");
        assertThat(created.active()).isTrue();

        List<StationDto> stations = stationService.listStations(ownBranch);
        assertThat(stations).extracting(StationDto::code).contains("GRILL");
    }

    @Test
    void createStation_duplicateCode_conflict() {
        stationService.createStation(ownBranch, new CreateStationRequest("GRILL", "Grill Line"));
        assertThatThrownBy(() -> stationService.createStation(ownBranch, new CreateStationRequest("GRILL", "Dup")))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void createStation_foreignBranch_denied() {
        assertThatThrownBy(() -> stationService.createStation(foreignBranch, new CreateStationRequest("BAR", "Bar")))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void listStations_foreignBranch_denied() {
        assertThatThrownBy(() -> stationService.listStations(foreignBranch))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void updateAndDeactivateStation_succeeds() {
        StationDto created = stationService.createStation(ownBranch, new CreateStationRequest("OVEN", "Oven"));

        StationDto updated = stationService.updateStation(created.id(), ownBranch, new UpdateStationRequest("Pizza Oven", true));
        assertThat(updated.name()).isEqualTo("Pizza Oven");

        StationDto deactivated = stationService.deactivateStation(created.id(), ownBranch);
        assertThat(deactivated.active()).isFalse();
    }

    @Test
    void updateStation_foreignBranch_denied() {
        StationDto created = stationService.createStation(ownBranch, new CreateStationRequest("OVEN", "Oven"));
        assertThatThrownBy(() -> stationService.updateStation(created.id(), foreignBranch, new UpdateStationRequest("X", true)))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void assignStation_setsFkAndMirrorsCode() {
        StationDto station = stationService.createStation(ownBranch, new CreateStationRequest("GRILL", "Grill Line"));

        MenuItemDto assigned = menuService.assignStation(menuItemId, ownBranch, station.id());
        assertThat(assigned.stationId()).isEqualTo(station.id());
        // Free-text kds_station mirrored to the canonical code for back-compat routing.
        assertThat(assigned.kdsStation()).isEqualTo("GRILL");
    }

    @Test
    void assignStation_foreignBranchStation_notFound() {
        // A station id that does not belong to the caller's branch must not be assignable.
        tenantContext.set(tenantId, foreignBranch, cashierId, null);
        StationDto foreign = stationService.createStation(foreignBranch, new CreateStationRequest("BAR", "Bar"));
        tenantContext.set(tenantId, ownBranch, cashierId, null);

        assertThatThrownBy(() -> menuService.assignStation(menuItemId, ownBranch, foreign.id()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void sendToKds_emitsStationIdAndCanonicalCode_forAssignedItem() {
        StationDto station = stationService.createStation(ownBranch, new CreateStationRequest("GRILL", "Grill Line"));
        menuService.assignStation(menuItemId, ownBranch, station.id());

        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                ownBranch, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, ownBranch, 1, null, null));

        outboxRepository.deleteAll();
        orderService.sendToKds(order.id(), null);

        List<OutboxEntry> sent = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .toList();
        assertThat(sent).hasSize(1);
        String json = sent.get(0).getEnvelopeJson();
        // Additive event fields present, plus canonical code carried in the retained kdsStation.
        assertThat(json).contains("\"stationId\":\"" + station.id() + "\"");
        assertThat(json).contains("Grill Line");
        assertThat(json).contains("GRILL");
    }

    @Test
    void sendToKds_unassignedItem_fallsBackToDefault_nullStationId() {
        // No station assigned, no free-text kds_station → DEFAULT, stationId null.
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                ownBranch, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, ownBranch, 1, null, null));

        outboxRepository.deleteAll();
        orderService.sendToKds(order.id(), null);

        String json = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .findFirst().orElseThrow().getEnvelopeJson();
        assertThat(json).contains("DEFAULT");
        assertThat(json).contains("\"stationId\":null");
    }
}
