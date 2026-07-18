package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.InventoryDtos.CreateUomRequest;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientDto;
import io.restaurantos.inventory.dto.InventoryDtos.UomDto;
import io.restaurantos.inventory.dto.InventoryDtos.UpdateIngredientRequest;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Ingredient + unit-of-measure master-data CRUD (INV-01). Tenant is always resolved from
 * {@link TenantContext} — a client can never supply its own tenant id (must_haves.prohibitions #2).
 */
@Service
@Transactional(readOnly = true)
public class IngredientService {

    private final IngredientRepository ingredientRepository;
    private final UnitOfMeasureRepository uomRepository;
    private final TenantContext tenantContext;

    public IngredientService(IngredientRepository ingredientRepository,
                              UnitOfMeasureRepository uomRepository,
                              TenantContext tenantContext) {
        this.ingredientRepository = ingredientRepository;
        this.uomRepository = uomRepository;
        this.tenantContext = tenantContext;
    }

    public List<IngredientDto> listIngredients() {
        return ingredientRepository.findAll().stream().map(IngredientService::toDto).toList();
    }

    public IngredientDto getIngredient(UUID id) {
        return toDto(requireIngredient(id));
    }

    @Transactional
    public IngredientDto createIngredient(CreateIngredientRequest request) {
        Ingredient ingredient = new Ingredient();
        ingredient.setTenantId(tenantContext.requireTenantId());
        ingredient.setName(request.name());
        ingredient.setSku(request.sku());
        ingredient.setBaseUomCode(request.baseUomCode());
        ingredient.setCategory(request.category());
        ingredient.setReorderPoint(request.reorderPoint());
        ingredient.setActive(true);
        return toDto(ingredientRepository.save(ingredient));
    }

    @Transactional
    public IngredientDto updateIngredient(UUID id, UpdateIngredientRequest request) {
        Ingredient ingredient = requireIngredient(id);
        ingredient.setName(request.name());
        ingredient.setBaseUomCode(request.baseUomCode());
        ingredient.setCategory(request.category());
        ingredient.setReorderPoint(request.reorderPoint());
        return toDto(ingredientRepository.save(ingredient));
    }

    public List<UomDto> listUoms() {
        return uomRepository.findAll().stream().map(IngredientService::toDto).toList();
    }

    @Transactional
    public UomDto createUom(CreateUomRequest request) {
        UnitOfMeasure uom = new UnitOfMeasure();
        uom.setTenantId(tenantContext.requireTenantId());
        uom.setCode(request.code());
        uom.setName(request.name());
        uom.setBaseUnitCode(request.baseUnitCode());
        uom.setToBaseFactor(request.toBaseFactor());
        return toDto(uomRepository.save(uom));
    }

    private Ingredient requireIngredient(UUID id) {
        return ingredientRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Ingredient", id));
    }

    private static IngredientDto toDto(Ingredient ingredient) {
        return new IngredientDto(
                ingredient.getId(),
                ingredient.getName(),
                ingredient.getSku(),
                ingredient.getBaseUomCode(),
                ingredient.getCategory(),
                ingredient.getReorderPoint(),
                ingredient.isActive());
    }

    private static UomDto toDto(UnitOfMeasure uom) {
        return new UomDto(
                uom.getId(),
                uom.getCode(),
                uom.getName(),
                uom.getBaseUnitCode(),
                uom.getToBaseFactor());
    }
}
