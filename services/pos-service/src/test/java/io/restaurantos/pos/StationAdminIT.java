package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.StationType;
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
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
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
    /**
     * Raw SQL, because two of the phase-28 cases are ABOUT the database rather than about the
     * service: one inserts a row the way a pre-migration row exists (no station_type column named,
     * so the DEFAULT supplies it), and one asserts the CHECK constraint refuses a value the Java
     * enum would never produce. Neither is expressible through the service, and going through the
     * service would prove the service's default rather than the migration's.
     */
    @Autowired JdbcTemplate jdbcTemplate;

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
        // MenuService.assignStation gates on pos.menu.manage at the SERVICE layer
        // (posAuthorizationService.requireMenuManage), which reads the Spring SecurityContext —
        // not TenantContext. This class only ever set TenantContext, so the three tests that go
        // through assignStation failed with "Requires pos.menu.manage" regardless of the behaviour
        // they were asserting. Mirrors MenuAdminIT.authenticateAs.
        authenticateAs(List.of("pos.menu.manage"));

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

    /** Mirrors MenuAdminIT.authenticateAs — service-layer permission gates read the Spring
     *  SecurityContext, which TenantContext does not populate. */
    private void authenticateAs(List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                cashierId, tenantId, ownBranch, List.of("OWNER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    // ── Phase 28: a station has a TYPE (D-28-01) ──────────────────────────────────────────────
    //
    // Appended. None of the nine tests above is modified: the two-argument request constructors
    // they use are retained deliberately, so the pre-existing behaviour is measured by the
    // pre-existing assertions rather than by rewritten ones.

    @Test
    void createStation_withNoTypeGiven_isKitchen() {
        StationDto created = stationService.createStation(ownBranch, new CreateStationRequest("GRILL", "Grill Line"));

        assertThat(created.stationType())
                .as("the do-nothing configuration must be today's behaviour exactly")
                .isEqualTo(StationType.KITCHEN);
        assertThat(created.displayFamily()).isEqualTo(StationType.DisplayFamily.KITCHEN);
    }

    @Test
    void everyStationRowThatPredatesTheMigration_readsBackAsKitchen() {
        // Written the way a pre-phase-28 row exists: INSERTed without the column, so the DEFAULT is
        // what supplies the value. Creating one through the service would prove the service's
        // default, not the migration's, and it is the migration that every existing tenant depends
        // on.
        jdbcTemplate.update(
                "INSERT INTO stations (id, tenant_id, branch_id, code, name, is_active) "
                        + "VALUES (?, ?, ?, 'LEGACY', 'Legacy Line', TRUE)",
                UUID.randomUUID(), tenantId, ownBranch);

        assertThat(stationService.listStations(ownBranch))
                .filteredOn(s -> "LEGACY".equals(s.code()))
                .singleElement()
                .extracting(StationDto::stationType)
                .isEqualTo(StationType.KITCHEN);
    }

    @Test
    void createStation_asBar_readsBackAsBar_onItsOwnDisplayFamily() {
        StationDto created = stationService.createStation(
                ownBranch, new CreateStationRequest("BAR", "Main Bar", StationType.BAR));

        assertThat(created.stationType()).isEqualTo(StationType.BAR);
        assertThat(created.displayFamily())
                .as("a bar ticket must not land on a cooking board")
                .isEqualTo(StationType.DisplayFamily.BAR);
    }

    @Test
    void updateStation_canChangeTheType_andOmittingItLeavesItAlone() {
        StationDto created = stationService.createStation(
                ownBranch, new CreateStationRequest("PREP", "Prep", StationType.KITCHEN));

        StationDto retyped = stationService.updateStation(
                created.id(), ownBranch, new UpdateStationRequest("Prep", true, StationType.PANTRY));
        assertThat(retyped.stationType()).isEqualTo(StationType.PANTRY);

        // The pre-phase-28 two-argument shape: rename only. It must NOT reset the type, because
        // every caller that predates this phase sends exactly this.
        StationDto renamed = stationService.updateStation(
                created.id(), ownBranch, new UpdateStationRequest("Cold Prep", true));
        assertThat(renamed.stationType())
                .as("absent means leave it alone, never 'make it KITCHEN'")
                .isEqualTo(StationType.PANTRY);
    }

    @Test
    void theDatabaseRefusesAnOutOfEnumType_soTheConstraintIsRealAndNotOnlyABeanValidationCourtesy() {
        assertThatThrownBy(() -> jdbcTemplate.update(
                "INSERT INTO stations (id, tenant_id, branch_id, code, name, is_active, station_type) "
                        + "VALUES (?, ?, ?, 'ROGUE', 'Rogue', TRUE, 'bar ')",
                UUID.randomUUID(), tenantId, ownBranch))
                .as("'bar ' with a trailing space is exactly how free text produces three bars")
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }

    @Test
    void listStations_canBeNarrowedToASingleType() {
        stationService.createStation(ownBranch, new CreateStationRequest("GRILL", "Grill", StationType.KITCHEN));
        stationService.createStation(ownBranch, new CreateStationRequest("BAR", "Main Bar", StationType.BAR));
        stationService.createStation(ownBranch, new CreateStationRequest("PASS", "The Pass", StationType.EXPO));

        assertThat(stationService.listStations(ownBranch, StationType.BAR))
                .extracting(StationDto::code)
                .containsExactly("BAR");
        assertThat(stationService.listStations(ownBranch, null))
                .as("unfiltered stays the default and stays byte-identical to what it always returned")
                .extracting(StationDto::code)
                .contains("GRILL", "BAR", "PASS");
    }

    @Test
    void branchIsolationStillHolds_forTheTypedListForm() {
        assertThatThrownBy(() -> stationService.listStations(foreignBranch, StationType.BAR))
                .isInstanceOf(PermissionDeniedException.class);
    }
}
