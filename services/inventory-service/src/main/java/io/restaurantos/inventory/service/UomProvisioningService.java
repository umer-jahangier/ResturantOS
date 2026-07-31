package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.inventory.service.StandardUomCatalog.StandardUom;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Provisions {@link StandardUomCatalog#ALL} into a tenant that is missing some or all of it.
 *
 * <p>{@code units_of_measure} is tenant-scoped under FORCE RLS and no migration has ever seeded
 * it, so every tenant created to date started with an empty unit list — and the ingredient form's
 * "Stock unit" is a required select with no create affordance behind it. That is a hard stop on
 * onboarding, not a cosmetic gap, so this runs lazily off the read and write paths that need units
 * ({@code IngredientService.listUoms} and both ingredient write methods) rather than waiting for a
 * cross-service tenant-provisioning hook. {@link #ensureStandardUoms} is safe to call from a
 * provisioning path later without changing anything here.
 *
 * <p>Idempotent and <em>additive</em>: it inserts only the standard codes the tenant does not
 * already have, compared case-insensitively. Deliberately NOT an "is the tenant empty?" check —
 * a tenant holding a single hand-created {@code g} row (which is exactly how the live tenants got
 * here) would otherwise stay stuck with one unit forever. Existing rows are never updated: a
 * tenant that renamed {@code CUP} or gave it a house factor keeps it.
 */
@Service
public class UomProvisioningService {

    private final UnitOfMeasureRepository uomRepository;

    public UomProvisioningService(UnitOfMeasureRepository uomRepository) {
        this.uomRepository = uomRepository;
    }

    /**
     * Returns the tenant's complete unit set, inserting any missing standard units first.
     *
     * <p>Returns the full list rather than {@code void} because every caller needs it immediately
     * afterwards — listing it, or indexing it to validate an ingredient's unit codes — and this
     * way the whole operation costs one read plus, at most once per tenant, one batch insert.
     */
    @Transactional
    public List<UnitOfMeasure> ensureStandardUoms(UUID tenantId) {
        // findByTenantId, never findAll: this read decides what to INSERT, so it cannot depend on
        // an ambient Hibernate filter being enabled on the session. Seeing another tenant's units
        // here would leave this tenant permanently short of the ones it appeared to already have.
        List<UnitOfMeasure> existing = uomRepository.findByTenantId(tenantId);

        // Key on the upper-cased code: the tenant's own casing wins, and a tenant that already has
        // 'g' must not also receive 'G'. V7's uq_uom_tenant_code_ci index guarantees this map can
        // never lose a row to a key collision.
        Map<String, UnitOfMeasure> byUpperCode = new HashMap<>();
        for (UnitOfMeasure uom : existing) {
            byUpperCode.put(normalize(uom.getCode()), uom);
        }

        List<UnitOfMeasure> missing = new ArrayList<>();
        for (StandardUom standard : StandardUomCatalog.ALL) {
            if (byUpperCode.containsKey(standard.code())) {
                continue;
            }
            UnitOfMeasure row = new UnitOfMeasure();
            row.setTenantId(tenantId);
            row.setCode(standard.code());
            row.setName(standard.name());
            row.setMeasureType(standard.measureType());
            row.setBaseUnitCode(resolveBaseUnitCode(standard, byUpperCode));
            row.setToBaseFactor(standard.toBaseFactor());
            missing.add(row);
            // Register before the insert so a later derived unit in the same pass resolves its
            // base against the row about to be written, not against the catalog's canonical code.
            byUpperCode.put(standard.code(), row);
        }

        if (missing.isEmpty()) {
            return existing;
        }

        List<UnitOfMeasure> saved = uomRepository.saveAll(missing);
        List<UnitOfMeasure> all = new ArrayList<>(existing.size() + saved.size());
        all.addAll(existing);
        all.addAll(saved);
        return all;
    }

    /**
     * Points a newly seeded derived unit at the tenant's OWN base-unit row when one already exists,
     * preserving its casing, and falls back to the catalog's canonical code otherwise.
     *
     * <p>This matters because {@code RecipeCostPreviewService.dimensionMatches} compares an
     * ingredient's {@code baseUomCode} against a unit's {@code baseUnitCode}. Seeding {@code KG}
     * with a hardcoded {@code base_unit_code = 'G'} into a tenant whose gram row is {@code g}
     * would produce a pair that never matches, silently un-costing every recipe line in kilograms.
     */
    private static String resolveBaseUnitCode(StandardUom standard, Map<String, UnitOfMeasure> byUpperCode) {
        if (standard.baseUnitCode() == null) {
            return null;
        }
        UnitOfMeasure existingBase = byUpperCode.get(normalize(standard.baseUnitCode()));
        return existingBase != null ? existingBase.getCode() : standard.baseUnitCode();
    }

    static String normalize(String code) {
        return code == null ? null : code.trim().toUpperCase(Locale.ROOT);
    }
}
