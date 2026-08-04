package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.dto.CreateVendorItemRequest;
import io.restaurantos.purchasing.dto.RecordVendorItemPriceRequest;
import io.restaurantos.purchasing.dto.VendorItemDto;
import io.restaurantos.purchasing.dto.VendorItemPriceChangeDto;
import io.restaurantos.purchasing.dto.VendorItemPriceDto;
import io.restaurantos.purchasing.exception.BackdatedPriceException;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.VendorItemPriceService;
import io.restaurantos.purchasing.service.VendorItemService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The plan's central invariant: {@code VendorItemPriceService.recordNewPrice} never mutates an
 * existing price row's {@code unitPricePaisa} — it only ever closes the prior row's {@code
 * effectiveTo} and inserts a new row (D-01 / T-08.2-082).
 */
class VendorItemPriceAppendOnlyIT extends PurchasingTestBase {

    @Autowired
    private VendorItemService vendorItemService;

    @Autowired
    private VendorItemPriceService vendorItemPriceService;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private TenantContext tenantContext;

    private UUID tenantId;
    private UUID vendorId;
    private UUID vendorItemId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        tenantContext.set(tenantId, UUID.randomUUID(), UUID.randomUUID(), null);

        Vendor vendor = new Vendor();
        vendor.setTenantId(tenantId);
        vendor.setName("Price Vendor " + UUID.randomUUID());
        vendor.setPaymentTerms("NET30");
        vendorId = vendorRepository.save(vendor).getId();

        VendorItemDto item = vendorItemService.create(vendorId, new CreateVendorItemRequest(
                UUID.randomUUID(), "SKU-PRICE-TEST", "Test item", null, "CASE", "5kg case",
                BigDecimal.valueOf(5), "kg", BigDecimal.ONE, BigDecimal.ONE, 2, false, false,
                null, null, null));
        vendorItemId = item.id();
    }

    private VendorItemPriceDto recordPrice(long unitPricePaisa, Instant effectiveFrom) {
        return vendorItemPriceService.recordNewPrice(vendorItemId, new RecordVendorItemPriceRequest(
                unitPricePaisa, "CASE", effectiveFrom, null, false, "MANUAL"));
    }

    @Test
    void recordingANewPriceInsertsARowAndClosesThePrior() {
        VendorItemPriceDto a = recordPrice(1000L, Instant.now().minus(2, ChronoUnit.DAYS));
        VendorItemPriceDto b = recordPrice(1200L, Instant.now());

        List<VendorItemPriceDto> history = vendorItemPriceService.listPrices(vendorItemId);
        assertThat(history).hasSize(2);

        VendorItemPriceDto closedA = history.stream().filter(p -> p.id().equals(a.id())).findFirst().orElseThrow();
        VendorItemPriceDto openB = history.stream().filter(p -> p.id().equals(b.id())).findFirst().orElseThrow();

        assertThat(closedA.effectiveTo()).isEqualTo(openB.effectiveFrom());
        assertThat(openB.effectiveTo()).isNull();
    }

    @Test
    void priorPriceRowIsNeverMutated() {
        VendorItemPriceDto a = recordPrice(1000L, Instant.now().minus(2, ChronoUnit.DAYS));
        long unitPriceBeforeSecondRecord = a.unitPricePaisa();

        recordPrice(1500L, Instant.now());

        VendorItemPriceDto reread = vendorItemPriceService.listPrices(vendorItemId).stream()
                .filter(p -> p.id().equals(a.id()))
                .findFirst()
                .orElseThrow();

        assertThat(reread.unitPricePaisa()).isEqualTo(unitPriceBeforeSecondRecord);
        assertThat(reread.unitPricePaisa()).isEqualTo(1000L);
    }

    @Test
    void currentPriceResolvesTheRowWhoseWindowCoversNow() {
        Instant past = Instant.now().minus(2, ChronoUnit.DAYS);
        Instant future = Instant.now().plus(2, ChronoUnit.DAYS);

        VendorItemPriceDto pastPrice = recordPrice(1000L, past);
        recordPrice(2000L, future); // closes pastPrice's effectiveTo at `future`, still covering "now"

        Optional<VendorItemPriceDto> current = vendorItemPriceService.currentPrice(vendorItemId, Instant.now());

        assertThat(current).isPresent();
        assertThat(current.get().id()).isEqualTo(pastPrice.id());
        assertThat(current.get().unitPricePaisa()).isEqualTo(1000L);
    }

    @Test
    void backdatingBeforeTheOpenRowIsRejected() {
        Instant open = Instant.now();
        recordPrice(1000L, open);

        assertThatThrownBy(() -> recordPrice(900L, open.minusSeconds(3600)))
                .isInstanceOf(BackdatedPriceException.class);
    }

    @Test
    void priceChangesReportsDeltaPercentages() {
        Instant t0 = Instant.now().minus(3, ChronoUnit.DAYS);
        Instant t1 = Instant.now().minus(2, ChronoUnit.DAYS);
        Instant t2 = Instant.now().minus(1, ChronoUnit.DAYS);

        recordPrice(1000L, t0);
        recordPrice(1100L, t1);
        recordPrice(990L, t2);

        List<VendorItemPriceChangeDto> changes = vendorItemPriceService.priceChanges(vendorId, null);

        assertThat(changes).hasSize(3);
        assertThat(changes.get(0).previousUnitPricePaisa()).isNull();
        assertThat(changes.get(0).deltaPct()).isNull();
        assertThat(changes.get(1).previousUnitPricePaisa()).isEqualTo(1000L);
        assertThat(changes.get(1).newUnitPricePaisa()).isEqualTo(1100L);
        assertThat(changes.get(1).deltaPct()).isEqualByComparingTo(BigDecimal.valueOf(10).setScale(2));
        assertThat(changes.get(2).previousUnitPricePaisa()).isEqualTo(1100L);
        assertThat(changes.get(2).newUnitPricePaisa()).isEqualTo(990L);
        assertThat(changes.get(2).deltaPct()).isEqualByComparingTo(BigDecimal.valueOf(-10).setScale(2));
    }

    @Test
    void priceHistorySurvivesCatalogItemArchive() {
        recordPrice(1000L, Instant.now());

        vendorItemService.archive(vendorItemId);

        List<VendorItemPriceDto> history = vendorItemPriceService.listPrices(vendorItemId);
        assertThat(history).isNotEmpty();
    }
}
