package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.dto.TableAdminDtos.CreateDiningTableRequest;
import io.restaurantos.pos.dto.TableAdminDtos.UpdateDiningTableRequest;
import io.restaurantos.pos.repository.DiningTableRepository;
import io.restaurantos.pos.service.TableService;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The dining-table catalogue (19b-01). Before this phase {@code POST /api/v1/pos/tables}
 * answered 405: the table existed, the entity existed, the waiter's picker existed and was
 * wired — there was simply no way to put a table into the catalogue the picker reads, so every
 * tenant in the product had zero tables and the picker was permanently empty.
 *
 * <h2>The two permissions</h2>
 *
 * <p>The assertions below deliberately test BOTH directions of the split, because getting it
 * wrong in either direction is silent. {@code pos.tables.manage} — which WAITER holds, on
 * purpose, since 055 — must keep working for seating; {@code pos.tables.admin} must be required
 * for anything that changes which tables exist. A waiter holding only the former can list and
 * seat, and is refused create, rename, retire, and the catalogue view.
 *
 * <h2>What a Testcontainers run can and cannot prove about tenancy</h2>
 *
 * <p>Testcontainers runs PostgreSQL as a SUPERUSER, and PostgreSQL bypasses row-level security
 * unconditionally for superusers. A green result here is therefore <em>no evidence whatsoever</em>
 * that RLS is scoping these reads — that is exactly how 33 tables shipped with inert isolation
 * and no test complained (see {@link RlsForcedInvariantIT}, which reproduces production's
 * ownership model precisely because this harness cannot).
 *
 * <p>So {@link #foreignTenantRowsAreInvisibleEvenWithRlsBypassed()} asserts the half a superuser
 * CAN observe: the tenant predicate written into the JPQL itself. With RLS bypassed, a foreign
 * tenant's table is excluded because the query excludes it, not because the database does. That
 * is the layer this phase added and the layer a superuser can see.
 */
class TableCatalogueIT extends PosTestBase {

    @Autowired TableService tableService;
    @Autowired DiningTableRepository tableRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tableRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        authenticateAs(List.of("pos.order.view", "pos.tables.manage", "pos.tables.admin"));
    }

    private void authenticateAs(List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                UUID.randomUUID(), tenantId, branchId, List.of("MANAGER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    /** A waiter: can see and seat tables, cannot decide which tables the restaurant has. */
    private void authenticateAsWaiter() {
        JwtClaims claims = new JwtClaims(
                UUID.randomUUID(), tenantId, branchId, List.of("WAITER"),
                List.of("pos.order.view", "pos.tables.manage"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    // ── Create ──────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a created table is immediately selectable — the gap this phase closes")
    void createdTableAppearsInTheServiceTimePicker() {
        DiningTable created = tableService.create(branchId,
                new CreateDiningTableRequest("T1", 4, "Garden"));

        assertThat(created.getTableNumber()).isEqualTo("T1");
        assertThat(created.getCapacity()).isEqualTo(4);
        assertThat(created.getSection()).isEqualTo("Garden");
        assertThat(created.isActive()).isTrue();
        assertThat(created.getStatus()).isEqualTo(TableStatus.AVAILABLE);
        assertThat(created.getBranchId()).isEqualTo(branchId);
        assertThat(created.getTenantId()).isEqualTo(tenantId);

        // listByBranch(false) is what the waiter's picker calls.
        assertThat(tableService.listByBranch(branchId, false))
                .extracting(DiningTable::getId).contains(created.getId());
    }

    @Test
    void aBlankSectionIsStoredAsNullRatherThanAnEmptyString() {
        DiningTable created = tableService.create(branchId,
                new CreateDiningTableRequest("T2", 2, "   "));
        assertThat(created.getSection()).isNull();
    }

    @Test
    @DisplayName("a duplicate table number is refused with a sentence, not a constraint violation")
    void duplicateTableNumberIsRejected() {
        tableService.create(branchId, new CreateDiningTableRequest("T1", 4, null));

        assertThatThrownBy(() -> tableService.create(branchId, new CreateDiningTableRequest("T1", 2, null)))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("already exists in this branch");
    }

    @Test
    @DisplayName("a RETIRED table still owns its number — the DB constraint does not care that it is inactive")
    void duplicateCheckIncludesRetiredTables() {
        DiningTable created = tableService.create(branchId, new CreateDiningTableRequest("T9", 4, null));
        tableService.setActive(created.getId(), branchId, false);

        assertThatThrownBy(() -> tableService.create(branchId, new CreateDiningTableRequest("T9", 4, null)))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("reactivate it instead");
    }

    @Test
    void tableNumberComparisonIsCaseInsensitive() {
        tableService.create(branchId, new CreateDiningTableRequest("t5", 4, null));
        assertThatThrownBy(() -> tableService.create(branchId, new CreateDiningTableRequest("T5", 4, null)))
                .isInstanceOf(StateInvalidException.class);
    }

    // ── Update ──────────────────────────────────────────────────────────────────────────────

    @Test
    void renameAndRecapacityLeaveRuntimeStatusUntouched() {
        DiningTable created = tableService.create(branchId, new CreateDiningTableRequest("T3", 4, "Hall"));
        tableService.updateStatus(created.getId(), branchId, TableStatus.OCCUPIED);

        DiningTable updated = tableService.update(created.getId(), branchId,
                new UpdateDiningTableRequest("Corner 3", 6, "Rooftop"));

        assertThat(updated.getTableNumber()).isEqualTo("Corner 3");
        assertThat(updated.getCapacity()).isEqualTo(6);
        assertThat(updated.getSection()).isEqualTo("Rooftop");
        // Renaming a table mid-service must not clear the party sitting at it.
        assertThat(updated.getStatus()).isEqualTo(TableStatus.OCCUPIED);
        assertThat(updated.isActive()).isTrue();
    }

    @Test
    void renamingATableToItsOwnNameIsNotADuplicate() {
        DiningTable created = tableService.create(branchId, new CreateDiningTableRequest("T4", 4, null));
        DiningTable updated = tableService.update(created.getId(), branchId,
                new UpdateDiningTableRequest("T4", 8, "Hall"));
        assertThat(updated.getCapacity()).isEqualTo(8);
    }

    // ── Retire / restore ────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a retired table leaves the picker but stays in the catalogue — never deleted")
    void deactivateHidesFromPickerButNotFromCatalogue() {
        DiningTable created = tableService.create(branchId, new CreateDiningTableRequest("T6", 4, null));

        DiningTable retired = tableService.setActive(created.getId(), branchId, false);

        assertThat(retired.isActive()).isFalse();
        assertThat(tableService.listByBranch(branchId, false))
                .extracting(DiningTable::getId).doesNotContain(created.getId());
        assertThat(tableService.listByBranch(branchId, true))
                .extracting(DiningTable::getId).contains(created.getId());
        // The row is still there: orders.table_id points at it and a closed order must keep
        // naming the table it was served at.
        assertThat(tableRepository.findById(created.getId())).isPresent();
    }

    @Test
    void reactivatingBringsATableBackIntoThePicker() {
        DiningTable created = tableService.create(branchId, new CreateDiningTableRequest("T7", 4, null));
        tableService.setActive(created.getId(), branchId, false);

        tableService.setActive(created.getId(), branchId, true);

        assertThat(tableService.listByBranch(branchId, false))
                .extracting(DiningTable::getId).contains(created.getId());
    }

    @Test
    @DisplayName("retiring an occupied table would strand the party sitting at it — refused")
    void cannotRetireATableThatIsOccupied() {
        DiningTable created = tableService.create(branchId, new CreateDiningTableRequest("T8", 4, null));
        tableService.updateStatus(created.getId(), branchId, TableStatus.OCCUPIED);

        assertThatThrownBy(() -> tableService.setActive(created.getId(), branchId, false))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("close or move its order");
    }

    @Test
    void aRetiredTableCannotBeSeated() {
        DiningTable created = tableService.create(branchId, new CreateDiningTableRequest("T10", 4, null));
        tableService.setActive(created.getId(), branchId, false);

        assertThatThrownBy(() -> tableService.updateStatus(created.getId(), branchId, TableStatus.OCCUPIED))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("no longer in service");
    }

    // ── Permissions: both directions ────────────────────────────────────────────────────────

    @Test
    @DisplayName("a WAITER may select and seat a table but must not manage the catalogue")
    void waiterCanListAndSeatButCannotAdminister() {
        DiningTable created = tableService.create(branchId, new CreateDiningTableRequest("W1", 4, null));

        authenticateAsWaiter();

        // Allowed — a waiter who cannot do these cannot work a floor.
        assertThat(tableService.listByBranch(branchId, false))
                .extracting(DiningTable::getId).contains(created.getId());
        assertThat(tableService.updateStatus(created.getId(), branchId, TableStatus.OCCUPIED).getStatus())
                .isEqualTo(TableStatus.OCCUPIED);

        // Refused — all four write paths plus the catalogue view.
        assertThatThrownBy(() -> tableService.create(branchId, new CreateDiningTableRequest("W2", 4, null)))
                .isInstanceOf(PermissionDeniedException.class)
                .hasMessageContaining("pos.tables.admin");
        assertThatThrownBy(() -> tableService.update(created.getId(), branchId,
                new UpdateDiningTableRequest("Renamed", 4, null)))
                .isInstanceOf(PermissionDeniedException.class);
        assertThatThrownBy(() -> tableService.setActive(created.getId(), branchId, false))
                .isInstanceOf(PermissionDeniedException.class);
        assertThatThrownBy(() -> tableService.listByBranch(branchId, true))
                .isInstanceOf(PermissionDeniedException.class)
                .hasMessageContaining("pos.tables.admin");
    }

    @Test
    @DisplayName("includeInactive is not a free widening of a read the waiter already has")
    void theCatalogueViewIsGatedEvenThoughTheListEndpointIsNot() {
        authenticateAsWaiter();
        assertThat(tableService.listByBranch(branchId, false)).isEmpty();
        assertThatThrownBy(() -> tableService.listByBranch(branchId, true))
                .isInstanceOf(PermissionDeniedException.class);
    }

    // ── Branch and tenant isolation ─────────────────────────────────────────────────────────

    @Test
    void cannotCreateATableInAnotherBranch() {
        UUID otherBranch = UUID.randomUUID();
        assertThatThrownBy(() -> tableService.create(otherBranch, new CreateDiningTableRequest("X1", 4, null)))
                .isInstanceOf(PermissionDeniedException.class)
                .hasMessageContaining("different branch");
    }

    @Test
    void cannotTouchATableInAnotherBranchOfTheSameTenant() {
        // A sibling branch's table, written directly so no branch guard is involved in the setup.
        DiningTable sibling = new DiningTable();
        sibling.setTenantId(tenantId);
        sibling.setBranchId(UUID.randomUUID());
        sibling.setTableNumber("SIB-1");
        sibling.setCapacity(4);
        sibling = tableRepository.save(sibling);

        UUID siblingId = sibling.getId();
        assertThatThrownBy(() -> tableService.update(siblingId, branchId,
                new UpdateDiningTableRequest("Hijacked", 4, null)))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("the tenant predicate in the JPQL holds even with RLS bypassed (superuser container)")
    void foreignTenantRowsAreInvisibleEvenWithRlsBypassed() {
        // Same branch id, DIFFERENT tenant. Under a superuser connection RLS does not apply at
        // all, so if the tenant scope lived only in the policy this row would come back — which
        // is precisely the failure mode 17b found in production and that a green suite hid.
        DiningTable foreign = new DiningTable();
        foreign.setTenantId(UUID.randomUUID());
        foreign.setBranchId(branchId);
        foreign.setTableNumber("FOREIGN-1");
        foreign.setCapacity(4);
        tableRepository.save(foreign);

        DiningTable mine = tableService.create(branchId, new CreateDiningTableRequest("MINE-1", 4, null));

        assertThat(tableService.listByBranch(branchId, false))
                .extracting(DiningTable::getId)
                .contains(mine.getId())
                .doesNotContain(foreign.getId());
        assertThat(tableService.listByBranch(branchId, true))
                .extracting(DiningTable::getId)
                .doesNotContain(foreign.getId());
        assertThat(tableRepository.findByIdTenantAndBranch(foreign.getId(), tenantId, branchId))
                .isEmpty();
        // And the duplicate check must not leak the foreign row's name either — otherwise a
        // manager is told "FOREIGN-1 already exists" about a table in someone else's restaurant.
        assertThat(tableRepository.existsByTableNumber(tenantId, branchId, "FOREIGN-1", null)).isFalse();
    }
}
