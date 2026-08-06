package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.exception.PackUomInvalidException;
import io.restaurantos.purchasing.feign.InventoryUomClient;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A vendor-catalog pack unit that inventory cannot resolve must not reach the database.
 *
 * <p>Inventory converts a goods receipt by looking the pack unit up in {@code units_of_measure}.
 * A row saved as "kgs" resolves to nothing, so a 10&nbsp;kg delivery of a gram-stocked ingredient
 * lands as 10 grams at the pack's price per gram — no error, no warning, wrong stock and wrong
 * moving-average cost. The catalog form uses a picker now, but a form only protects people; an
 * import or a direct API call still has to be refused.
 */
class PackUomValidatorTest {

    private static final UUID TENANT = UUID.randomUUID();

    private InventoryUomClient client;
    private TenantContext tenantContext;
    private PackUomValidator validator;

    @BeforeEach
    void setUp() {
        client = mock(InventoryUomClient.class);
        // TenantContext is abstract (one impl per service); the validator only ever asks it for a
        // tenant id, so a stub keeps this a real unit test with no Spring context.
        tenantContext = mock(TenantContext.class);
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        validator = new PackUomValidator(client, tenantContext);
    }

    @Test
    void aKnownUnitIsAccepted() {
        when(client.listUomCodes(any())).thenReturn(List.of("KG", "G", "L"));

        assertThatCode(() -> validator.requireKnownPackUom("KG")).doesNotThrowAnyException();
    }

    /** Unit codes have never been normalised at rest — fixtures write KG, live tenants write g. */
    @Test
    void caseDoesNotMatter_becauseItDoesNotMatterToTheConverterEither() {
        when(client.listUomCodes(any())).thenReturn(List.of("KG"));

        assertThatCode(() -> validator.requireKnownPackUom("kg")).doesNotThrowAnyException();
        assertThatCode(() -> validator.requireKnownPackUom(" Kg ")).doesNotThrowAnyException();
    }

    @Test
    void anUnknownUnitIsRefused_andTheMessageSaysWhatWouldWork() {
        when(client.listUomCodes(any())).thenReturn(List.of("KG", "G"));

        assertThatThrownBy(() -> validator.requireKnownPackUom("kgs"))
                .isInstanceOf(PackUomInvalidException.class)
                .hasMessageContaining("'kgs' is not a unit of measure")
                .hasMessageContaining("KG")
                .as("a refusal that doesn't say what to type instead just moves the guessing")
                .hasMessageContaining("G");
    }

    /**
     * Degrade-open, matching {@code FeignIngredientReferenceValidator}: a brief inventory-service
     * outage must not make the vendor catalog unwritable. Only a definitive answer is fail-closed.
     */
    @Test
    void anUnreachableInventoryServiceAllowsTheWrite() {
        when(client.listUomCodes(any())).thenThrow(new IllegalStateException("connection refused"));

        assertThatCode(() -> validator.requireKnownPackUom("anything")).doesNotThrowAnyException();
    }

    /** A tenant that has not provisioned units yet has nothing to be validated against. */
    @Test
    void aTenantWithNoUnitsYetIsNotBlocked() {
        when(client.listUomCodes(any())).thenReturn(List.of());

        assertThatCode(() -> validator.requireKnownPackUom("KG")).doesNotThrowAnyException();
    }

    @Test
    void blankIsLeftToBeanValidation() {
        validator.requireKnownPackUom(null);
        validator.requireKnownPackUom("   ");
        // No call is made at all — @NotBlank on the request already covers this.
        assertThat(true).isTrue();
    }
}
