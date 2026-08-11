package io.restaurantos.hr;

import io.restaurantos.hr.dto.HrConfigDtos.CreateDepartmentRequest;
import io.restaurantos.hr.dto.HrConfigDtos.CreateDesignationRequest;
import io.restaurantos.hr.dto.HrConfigDtos.DepartmentResponse;
import io.restaurantos.hr.dto.HrConfigDtos.DesignationResponse;
import io.restaurantos.hr.dto.HrConfigDtos.RenameDepartmentRequest;
import io.restaurantos.hr.service.HrConfigService;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.tenant.TenantContext;
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
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * The two worst free-text fields in the product, as tenant-managed lists (D-35-01).
 *
 * <p>The defect being closed is the user's own words: "Waiter", "waiter" and "Wtr" as three
 * departments that no report can group. The database's functional unique index is what makes that
 * impossible; these tests assert the SERVICE turns that into a message naming the field, because a
 * 409 with no field path cannot be bound to a form input.
 */
class HrConfigListsIT extends HrTestBase {

    @Autowired HrConfigService hrConfigService;
    @Autowired TenantContext tenantContext;

    @Test
    @DisplayName("a created department comes back with an id and lists for that tenant only")
    void createAndListIsTenantScoped() {
        UUID tenantA = UUID.randomUUID();
        UUID tenantB = UUID.randomUUID();

        DepartmentResponse kitchen = as(tenantA, () ->
                hrConfigService.createDepartment(new CreateDepartmentRequest("Kitchen", "KIT")));
        assertThat(kitchen.id()).isNotNull();
        assertThat(kitchen.active()).isTrue();

        as(tenantB, () ->
                hrConfigService.createDepartment(new CreateDepartmentRequest("Housekeeping", null)));

        assertThat(as(tenantA, hrConfigService::listDepartments))
                .extracting(DepartmentResponse::name)
                .containsExactly("Kitchen");
        assertThat(as(tenantB, hrConfigService::listDepartments))
                .extracting(DepartmentResponse::name)
                .containsExactly("Housekeeping");
    }

    /** The exact defect the phase exists to remove. */
    @Test
    @DisplayName("a case- or whitespace-variant department name is refused, naming the name field")
    void caseVariantNameIsRefusedWithAFieldPath() {
        UUID tenant = UUID.randomUUID();
        as(tenant, () -> hrConfigService.createDepartment(new CreateDepartmentRequest("Waiter", null)));

        for (String variant : List.of("waiter", "WAITER", "  Waiter  ")) {
            DuplicateValueException thrown = as(tenant, () -> catchThrowableOfType(
                    DuplicateValueException.class,
                    () -> hrConfigService.createDepartment(new CreateDepartmentRequest(variant, null))));

            assertThat(thrown).as("'%s' must collide with 'Waiter'", variant).isNotNull();
            assertThat(thrown.getCode()).isEqualTo("DUPLICATE_VALUE");
            assertThat(thrown.getField())
                    .as("without a field path the form cannot bind this to the name input")
                    .isEqualTo("name");
        }
    }

    @Test
    @DisplayName("renaming onto an existing name collides; renaming to its own name does not")
    void renameCollidesButNotWithItself() {
        UUID tenant = UUID.randomUUID();
        DepartmentResponse kitchen = as(tenant, () ->
                hrConfigService.createDepartment(new CreateDepartmentRequest("Kitchen", null)));
        as(tenant, () -> hrConfigService.createDepartment(new CreateDepartmentRequest("Bar", null)));

        DuplicateValueException thrown = as(tenant, () -> catchThrowableOfType(
                DuplicateValueException.class,
                () -> hrConfigService.renameDepartment(kitchen.id(), new RenameDepartmentRequest("bar", null))));
        assertThat(thrown).isNotNull();
        assertThat(thrown.getField()).isEqualTo("name");

        // Renaming a row to the name it already holds must not collide with itself — the excludeId
        // half of the uniqueness query. Without it, editing only the code would be impossible.
        DepartmentResponse renamed = as(tenant, () ->
                hrConfigService.renameDepartment(kitchen.id(), new RenameDepartmentRequest("Kitchen", "K2")));
        assertThat(renamed.code()).isEqualTo("K2");
    }

    @Test
    @DisplayName("listing needs only view; creating needs manage")
    void readsAndWritesHaveDifferentPermissions() {
        UUID tenant = UUID.randomUUID();
        as(tenant, () -> hrConfigService.createDepartment(new CreateDepartmentRequest("Kitchen", null)));

        UUID branch = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            // A manager: may read the options to fill an employee form, may not edit the lists.
            withPermissions(tenant, branch, List.of("hr.config.view", "hr.employee.manage"));

            assertThat(hrConfigService.listDepartments()).hasSize(1);
            assertThatThrownBy(() ->
                    hrConfigService.createDepartment(new CreateDepartmentRequest("Bar", null)))
                    .isInstanceOf(PermissionDeniedException.class);
        } finally {
            SecurityContextHolder.clearContext();
            tenantContext.clear();
        }
    }

    @Test
    @DisplayName("a caller in another tenant cannot read or mutate, and the denial is the policy's")
    void crossTenantIsDeniedByThePolicy() {
        UUID owner = UUID.randomUUID();
        DepartmentResponse theirs = as(owner, () ->
                hrConfigService.createDepartment(new CreateDepartmentRequest("Kitchen", null)));

        UUID intruder = UUID.randomUUID();
        assertThat(as(intruder, hrConfigService::listDepartments))
                .as("RLS must hide another tenant's rows entirely")
                .isEmpty();

        // And the mutation is refused by OPA rather than merely finding no row.
        assertThatThrownBy(() -> as(intruder, () ->
                hrConfigService.renameDepartment(theirs.id(), new RenameDepartmentRequest("Mine", null))))
                .isInstanceOf(RuntimeException.class);
    }

    @Test
    @DisplayName("a deactivated department stays resolvable but is marked inactive")
    void deactivationKeepsTheRowResolvable() {
        UUID tenant = UUID.randomUUID();
        DepartmentResponse kitchen = as(tenant, () ->
                hrConfigService.createDepartment(new CreateDepartmentRequest("Kitchen", null)));

        DepartmentResponse deactivated =
                as(tenant, () -> hrConfigService.setDepartmentActive(kitchen.id(), false));
        assertThat(deactivated.active()).isFalse();

        // Still returned by the list, distinguishably — a settings screen shows both, a picker
        // filters to active. One endpoint, two legitimate consumers.
        assertThat(as(tenant, hrConfigService::listDepartments))
                .singleElement()
                .satisfies(d -> {
                    assertThat(d.id()).isEqualTo(kitchen.id());
                    assertThat(d.active()).isFalse();
                });

        // And it can come back.
        assertThat(as(tenant, () -> hrConfigService.setDepartmentActive(kitchen.id(), true)).active())
                .isTrue();
    }

    @Test
    @DisplayName("a designation may have no parent, and cannot have another tenant's department")
    void designationParentIsOptionalButMustBeInTenant() {
        UUID tenant = UUID.randomUUID();
        UUID otherTenant = UUID.randomUUID();

        DesignationResponse unattached = as(tenant, () ->
                hrConfigService.createDesignation(new CreateDesignationRequest("Chef", null, null)));
        assertThat(unattached.departmentId()).isNull();

        DepartmentResponse ourKitchen = as(tenant, () ->
                hrConfigService.createDepartment(new CreateDepartmentRequest("Kitchen", null)));
        DesignationResponse attached = as(tenant, () ->
                hrConfigService.createDesignation(
                        new CreateDesignationRequest("Sous Chef", null, ourKitchen.id())));
        assertThat(attached.departmentId()).isEqualTo(ourKitchen.id());

        DepartmentResponse theirDept = as(otherTenant, () ->
                hrConfigService.createDepartment(new CreateDepartmentRequest("Their Kitchen", null)));

        FieldValidationException thrown = as(tenant, () -> catchThrowableOfType(
                FieldValidationException.class,
                () -> hrConfigService.createDesignation(
                        new CreateDesignationRequest("Intruder", null, theirDept.id()))));
        assertThat(thrown).isNotNull();
        assertThat(thrown.getViolations()).singleElement()
                .satisfies(v -> assertThat(v.field()).isEqualTo("departmentId"));
    }

    @Test
    @DisplayName("names are stored trimmed, so a trailing space cannot masquerade as a distinct row")
    void namesAreStoredTrimmed() {
        UUID tenant = UUID.randomUUID();
        DepartmentResponse d = as(tenant, () ->
                hrConfigService.createDepartment(new CreateDepartmentRequest("  Front of House  ", null)));
        assertThat(d.name()).isEqualTo("Front of House");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private <T> T as(UUID tenantId, java.util.function.Supplier<T> action) {
        tenantContext.set(tenantId, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            return action.get();
        } finally {
            tenantContext.clear();
        }
    }

    private void as(UUID tenantId, Runnable action) {
        as(tenantId, () -> {
            action.run();
            return null;
        });
    }

    private static void withPermissions(UUID tenantId, UUID branchId, List<String> permissions) {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("MANAGER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }
}
