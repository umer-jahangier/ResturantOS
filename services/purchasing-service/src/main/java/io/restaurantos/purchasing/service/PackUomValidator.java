package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.exception.PackUomInvalidException;
import io.restaurantos.purchasing.feign.InventoryUomClient;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Refuses a vendor-catalog pack unit that inventory would not be able to convert.
 *
 * <p><b>Why the API needs this and not just the form.</b> A goods receipt arrives in the vendor's
 * pack unit and inventory converts it into the ingredient's stock unit by looking that string up
 * in {@code units_of_measure}. A row saved as "kgs" resolves to nothing, so the receipt is taken
 * at face value: 10&nbsp;kg of a gram-stocked ingredient becomes 10 grams, at the pack's price per
 * gram. The catalog form now uses a picker, which stops a person typing that — but an import, a
 * script or any direct API call still could, and the damage is silent.
 *
 * <p>Checked case-insensitively, because unit codes have never been normalised at rest: fixtures
 * write {@code KG} while live tenant rows use lowercase {@code g}. The same comparison
 * {@code GrnUomResolver} uses when it converts, so what passes here is exactly what converts there.
 *
 * <p><b>Degrades open on a transport failure</b>, matching {@code FeignIngredientReferenceValidator}'s
 * contract: a brief inventory-service outage must not make the vendor catalog unwritable. A
 * definitive answer — the registry was read, and the code is not in it — is fail-closed.
 */
@Service
public class PackUomValidator {

    private static final Logger log = LoggerFactory.getLogger(PackUomValidator.class);

    private final InventoryUomClient inventoryUomClient;
    private final TenantContext tenantContext;

    public PackUomValidator(InventoryUomClient inventoryUomClient, TenantContext tenantContext) {
        this.inventoryUomClient = inventoryUomClient;
        this.tenantContext = tenantContext;
    }

    /**
     * @param packUom the unit the catalog row's pack quantity is expressed in
     * @throws PackUomInvalidException if the tenant's registry was readable and does not define it
     */
    public void requireKnownPackUom(String packUom) {
        if (packUom == null || packUom.isBlank()) {
            return;   // @NotBlank on the request already rejects this
        }
        UUID tenantId = tenantContext.requireTenantId();

        List<String> codes;
        try {
            codes = inventoryUomClient.listUomCodes(tenantId);
        } catch (Exception e) {
            log.warn("Pack-UOM check could not reach inventory-service for tenant {}; allowing '{}' "
                            + "(degrade-open, same contract as the ingredient-reference check): {}",
                    tenantId, packUom, e.getMessage());
            return;
        }
        if (codes == null || codes.isEmpty()) {
            // A tenant with no units provisioned yet has nothing to validate against; refusing here
            // would make the catalog unusable before inventory setup rather than after it.
            return;
        }

        Set<String> known = codes.stream()
                .map(c -> c.toLowerCase(Locale.ROOT))
                .collect(Collectors.toSet());
        if (!known.contains(packUom.trim().toLowerCase(Locale.ROOT))) {
            throw new PackUomInvalidException(packUom, codes);
        }
    }
}
