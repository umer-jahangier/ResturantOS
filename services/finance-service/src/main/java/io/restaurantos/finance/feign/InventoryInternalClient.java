package io.restaurantos.finance.feign;

import io.restaurantos.finance.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.time.LocalDate;

@FeignClient(
        name = "inventory-service",
        configuration = FeignClientConfig.class,
        fallback = InventoryInternalClientFallback.class
)
public interface InventoryInternalClient {

    @GetMapping("/internal/grn/pending-count")
    long getPendingGrnCount(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd
    );
}
