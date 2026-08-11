package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.ServiceModel;
import io.restaurantos.pos.domain.model.StationType;
import io.restaurantos.pos.dto.CreatePosTerminalRequest;
import io.restaurantos.pos.dto.CreateStationRequest;
import io.restaurantos.pos.dto.PosTerminalDto;
import io.restaurantos.pos.dto.StationDto;
import io.restaurantos.pos.dto.UpdatePosTerminalRequest;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.service.PosTerminalService;
import io.restaurantos.pos.service.StationService;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * A POS terminal is a named profile a tenant admin can create, scope and retire (28-04, D-28-03) —
 * the "dedicated POS selecting the respective menu" this phase exists for.
 *
 * <h2>The two assertions that carry the plan</h2>
 *
 * <p>{@link #aTerminalWithNoCategoryRows_offersTheWholeMenu()} — empty means EVERYTHING, not
 * nothing. It is the only encoding under which a tenant who never opens this screen keeps today's
 * behaviour, and today's behaviour is one POS showing the whole card. There is no {@code servesAll}
 * flag and there must never be one: a flag and the rows it summarises can disagree, and then one of
 * them is wrong with nothing to say which.
 *
 * <p>{@link #aForeignTenantsCategory_isRefused()} and
 * {@link #aStationFromAnotherBranch_isRefused()} — the two cases that would silently corrupt a
 * configuration rather than fail loudly. Asserted rather than argued.
 */
class PosTerminalAdminIT extends PosTestBase {

    @Autowired PosTerminalService terminalService;
    @Autowired StationService stationService;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;
    @Autowired JdbcTemplate jdbcTemplate;

    UUID tenantId;
    UUID ownBranch;
    UUID foreignBranch;
    UUID userId;
    UUID categoryId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        ownBranch = UUID.randomUUID();
        foreignBranch = UUID.randomUUID();
        userId = UUID.randomUUID();
        tenantContext.set(tenantId, ownBranch, userId, null);
        authenticateAs(List.of("pos.terminals.admin", "pos.menu.manage", "pos.menu.view"));

        MenuCategory category = new MenuCategory();
        category.setTenantId(tenantId);
        category.setName("Drinks-" + UUID.randomUUID());
        categoryId = menuCategoryRepository.save(category).getId();
    }

    // ── Task 1: the row and its scope tables ─────────────────────────────────────────────────

    @Test
    void aTerminalPersistsAndReadsBackUnchanged() {
        PosTerminalDto created = terminalService.create(ownBranch, new CreatePosTerminalRequest(
                "BAR-1", "Bar Till", ServiceModel.COUNTER, OrderType.DINE_IN, "printer-a", null, null));

        assertThat(created.id()).isNotNull();
        assertThat(created.active()).isTrue();

        PosTerminalDto read = terminalService.get(created.id(), ownBranch);
        assertThat(read.code()).isEqualTo("BAR-1");
        assertThat(read.name()).isEqualTo("Bar Till");
        assertThat(read.serviceModel()).isEqualTo(ServiceModel.COUNTER);
        assertThat(read.defaultOrderType()).isEqualTo(OrderType.DINE_IN);
        assertThat(read.printerRef()).isEqualTo("printer-a");
        assertThat(read.branchId()).isEqualTo(ownBranch);
    }

    @Test
    void twoTerminalsInOneBranchCannotShareACode_andTheDatabaseRefusesItToo() {
        terminalService.create(ownBranch, terminal("COUNTER-1"));

        assertThatThrownBy(() -> terminalService.create(ownBranch, terminal("COUNTER-1")))
                .as("a clean conflict, not a database error surfacing as a 500")
                .isInstanceOf(StateInvalidException.class);

        // And the constraint is real, not merely a service courtesy — a concurrent create that
        // slipped past the pre-check still cannot land.
        assertThatThrownBy(() -> jdbcTemplate.update(
                "INSERT INTO pos_terminals (id, tenant_id, branch_id, code, name, service_model) "
                        + "VALUES (?, ?, ?, 'COUNTER-1', 'Race', 'COUNTER')",
                UUID.randomUUID(), tenantId, ownBranch))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void twoBranchesOfOneTenantMayBothHaveACounterOne() {
        terminalService.create(ownBranch, terminal("COUNTER-1"));

        tenantContext.set(tenantId, foreignBranch, userId, null);
        PosTerminalDto other = terminalService.create(foreignBranch, terminal("COUNTER-1"));

        assertThat(other.code())
                .as("a code is unique WITHIN a branch, so neither branch has to invent a prefix")
                .isEqualTo("COUNTER-1");
    }

    @Test
    void aTerminalWithNoCategoryRows_offersTheWholeMenu() {
        PosTerminalDto created = terminalService.create(ownBranch, terminal("COUNTER-1"));

        assertThat(created.categoryIds()).isEmpty();
        assertThat(created.offersWholeMenu())
                .as("empty means EVERYTHING. This is the do-nothing configuration and it must be "
                        + "today's behaviour exactly — one POS showing the whole card.")
                .isTrue();
    }

    @Test
    void aTerminalWithCategoryRows_offersExactlyThose() {
        PosTerminalDto created = terminalService.create(ownBranch, new CreatePosTerminalRequest(
                "BAR-1", "Bar Till", ServiceModel.COUNTER, null, null, List.of(categoryId), null));

        assertThat(created.categoryIds()).containsExactly(categoryId);
        assertThat(created.offersWholeMenu()).isFalse();
    }

    @Test
    void aTerminalWithNoStationRows_firesToEveryStation() {
        PosTerminalDto created = terminalService.create(ownBranch, terminal("COUNTER-1"));

        assertThat(created.stationIds()).isEmpty();
        assertThat(created.firesToAllStations()).isTrue();
    }

    @Test
    void aTerminalWithStationRows_firesToExactlyThose() {
        StationDto bar = stationService.createStation(
                ownBranch, new CreateStationRequest("BAR", "Main Bar", StationType.BAR));

        PosTerminalDto created = terminalService.create(ownBranch, new CreatePosTerminalRequest(
                "BAR-1", "Bar Till", ServiceModel.COUNTER, null, null, null, List.of(bar.id())));

        assertThat(created.stationIds()).containsExactly(bar.id());
        assertThat(created.firesToAllStations()).isFalse();
    }

    @Test
    void everyFinderReturnsNothingForATenantThatDoesNotOwnTheRow_evenWithThePolicyInert() {
        // Testcontainers runs as a SUPERUSER and superusers bypass row security entirely, so the
        // tenant_isolation policy is inert in this JVM. The explicit tenant predicate on every
        // finder is the half of the isolation CI can actually assert — and it is the half that
        // still holds if the tenant GUC is ever not set on a connection.
        PosTerminalDto mine = terminalService.create(ownBranch, terminal("COUNTER-1"));

        UUID otherTenant = UUID.randomUUID();
        tenantContext.set(otherTenant, ownBranch, userId, null);

        assertThatThrownBy(() -> terminalService.get(mine.id(), ownBranch))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(terminalService.list(ownBranch, false)).isEmpty();
    }

    // ── Task 2: the admin API ────────────────────────────────────────────────────────────────

    @Test
    void anAdminRenamesRetypesAndReplacesBothScopes() {
        StationDto bar = stationService.createStation(
                ownBranch, new CreateStationRequest("BAR", "Main Bar", StationType.BAR));
        PosTerminalDto created = terminalService.create(ownBranch, terminal("BAR-1"));

        PosTerminalDto updated = terminalService.update(created.id(), ownBranch,
                new UpdatePosTerminalRequest("Cocktail Bar", ServiceModel.TABLE_SERVICE,
                        OrderType.DINE_IN, "printer-b", List.of(categoryId), List.of(bar.id())));

        assertThat(updated.name()).isEqualTo("Cocktail Bar");
        assertThat(updated.serviceModel()).isEqualTo(ServiceModel.TABLE_SERVICE);
        assertThat(updated.categoryIds()).containsExactly(categoryId);
        assertThat(updated.stationIds()).containsExactly(bar.id());
        assertThat(updated.code())
                .as("the code is immutable — a device remembers which terminal it is by it")
                .isEqualTo("BAR-1");
    }

    @Test
    void replacingTheCategorySetWithAnEmptySet_returnsTheTerminalToOfferingEverything() {
        PosTerminalDto created = terminalService.create(ownBranch, new CreatePosTerminalRequest(
                "BAR-1", "Bar Till", ServiceModel.COUNTER, null, null, List.of(categoryId), null));
        assertThat(created.offersWholeMenu()).isFalse();

        PosTerminalDto widened = terminalService.update(created.id(), ownBranch,
                new UpdatePosTerminalRequest("Bar Till", null, null, null, List.of(), null));

        assertThat(widened.offersWholeMenu()).isTrue();
        assertThat(widened.categoryIds()).isEmpty();
    }

    @Test
    void aNullScopeListLeavesThatScopeAlone_ratherThanSilentlyWideningIt() {
        PosTerminalDto created = terminalService.create(ownBranch, new CreatePosTerminalRequest(
                "BAR-1", "Bar Till", ServiceModel.COUNTER, null, null, List.of(categoryId), null));

        // A rename-only update. If null meant "empty", this would quietly widen the bar terminal
        // to the whole menu and nobody would be told.
        PosTerminalDto renamed = terminalService.update(created.id(), ownBranch,
                new UpdatePosTerminalRequest("Cocktail Bar", null, null, null, null, null));

        assertThat(renamed.categoryIds()).containsExactly(categoryId);
        assertThat(renamed.offersWholeMenu()).isFalse();
    }

    @Test
    void aForeignTenantsCategory_isRefused() {
        UUID foreignTenant = UUID.randomUUID();
        tenantContext.set(foreignTenant, ownBranch, userId, null);
        MenuCategory theirs = new MenuCategory();
        theirs.setTenantId(foreignTenant);
        theirs.setName("Their Drinks");
        UUID theirCategoryId = menuCategoryRepository.save(theirs).getId();
        tenantContext.set(tenantId, ownBranch, userId, null);

        assertThatThrownBy(() -> terminalService.create(ownBranch, new CreatePosTerminalRequest(
                "BAR-1", "Bar Till", ServiceModel.COUNTER, null, null, List.of(theirCategoryId), null)))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aStationFromAnotherBranch_isRefused() {
        tenantContext.set(tenantId, foreignBranch, userId, null);
        StationDto theirGrill = stationService.createStation(
                foreignBranch, new CreateStationRequest("GRILL", "Their Grill"));
        tenantContext.set(tenantId, ownBranch, userId, null);

        assertThatThrownBy(() -> terminalService.create(ownBranch, new CreatePosTerminalRequest(
                "COUNTER-1", "Counter", ServiceModel.COUNTER, null, null, null, List.of(theirGrill.id()))))
                .as("a terminal firing to another branch's grill sends tickets to a kitchen in "
                        + "another building")
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aPartiallyValidScopeIsRejectedWholesale_leavingNothingHalfApplied() {
        PosTerminalDto created = terminalService.create(ownBranch, terminal("COUNTER-1"));

        assertThatThrownBy(() -> terminalService.update(created.id(), ownBranch,
                new UpdatePosTerminalRequest("Counter", null, null, null,
                        List.of(categoryId, UUID.randomUUID()), null)))
                .isInstanceOf(ResourceNotFoundException.class);

        assertThat(terminalService.get(created.id(), ownBranch).categoryIds())
                .as("an admin who submitted one intention must not get half of it")
                .isEmpty();
    }

    @Test
    void aTerminalIsDeactivatedAndReactivated_andThereIsNoDelete() {
        PosTerminalDto created = terminalService.create(ownBranch, terminal("COUNTER-1"));

        assertThat(terminalService.deactivate(created.id(), ownBranch).active()).isFalse();
        assertThat(terminalService.reactivate(created.id(), ownBranch).active()).isTrue();

        // There is no delete method on the service and no DELETE mapping on the controller. From
        // 28-12 orders.terminal_id references these rows.
        assertThat(java.util.Arrays.stream(io.restaurantos.pos.service.PosTerminalService.class.getMethods())
                .map(java.lang.reflect.Method::getName))
                .noneMatch(n -> n.toLowerCase().contains("delete"));
    }

    @Test
    void listingReturnsOnlyActiveTerminals_unlessRetiredOnesAreExplicitlyAskedFor() {
        PosTerminalDto live = terminalService.create(ownBranch, terminal("COUNTER-1"));
        PosTerminalDto retired = terminalService.create(ownBranch, terminal("COUNTER-2"));
        terminalService.deactivate(retired.id(), ownBranch);

        assertThat(terminalService.list(ownBranch, false)).extracting(PosTerminalDto::id)
                .containsExactly(live.id());
        assertThat(terminalService.list(ownBranch, true)).extracting(PosTerminalDto::id)
                .containsExactlyInAnyOrder(live.id(), retired.id());
    }

    @Test
    void aCallerWithoutTheTerminalPermission_isRefusedEveryWriteAndTheRetiredView() {
        PosTerminalDto created = terminalService.create(ownBranch, terminal("COUNTER-1"));

        authenticateAs(List.of("pos.menu.view"));

        assertThatThrownBy(() -> terminalService.create(ownBranch, terminal("COUNTER-2")))
                .isInstanceOf(PermissionDeniedException.class);
        assertThatThrownBy(() -> terminalService.update(created.id(), ownBranch,
                new UpdatePosTerminalRequest("X", null, null, null, null, null)))
                .isInstanceOf(PermissionDeniedException.class);
        assertThatThrownBy(() -> terminalService.deactivate(created.id(), ownBranch))
                .isInstanceOf(PermissionDeniedException.class);
        assertThatThrownBy(() -> terminalService.list(ownBranch, true))
                .as("the includeInactive flag is an admin capability; gating it on the controller "
                        + "would have had to use the WEAKER permission and left the flag itself "
                        + "as an unguarded escalation")
                .isInstanceOf(PermissionDeniedException.class);

        // ...and the ordinary read still works, which is the whole reason the flag is gated
        // separately rather than the endpoint being locked down.
        assertThat(terminalService.list(ownBranch, false)).hasSize(1);
    }

    @Test
    void aCallerFromAnotherBranch_isRefused() {
        assertThatThrownBy(() -> terminalService.create(foreignBranch, terminal("COUNTER-1")))
                .isInstanceOf(PermissionDeniedException.class);
        assertThatThrownBy(() -> terminalService.list(foreignBranch, false))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void noServesAllFlagExistsAnywhereInTheSchemaOrTheEntity() {
        // The prohibition, made unbreakable rather than merely written down. A future reader who
        // "fixes" the empty-means-everything default by adding a flag fails here.
        Integer columns = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM information_schema.columns "
                        + "WHERE table_name IN ('pos_terminals','pos_terminal_categories','pos_terminal_stations') "
                        + "AND (column_name LIKE '%serves_all%' OR column_name LIKE '%all_categories%' "
                        + "OR column_name LIKE '%requires_till%')",
                Integer.class);
        assertThat(columns)
                .as("empty scope is the ONLY encoding of 'everything'; a flag and the rows it "
                        + "summarises can disagree. And requires_till is a money change owned by "
                        + "its own phase (D-28-06), not a column added here as decoration.")
                .isZero();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private CreatePosTerminalRequest terminal(String code) {
        return new CreatePosTerminalRequest(code, code + " Till", ServiceModel.COUNTER,
                null, null, null, null);
    }

    private void authenticateAs(List<String> permissions) {
        JwtClaims claims = new JwtClaims(userId, tenantId, ownBranch, List.of("MANAGER"),
                permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }
}
