package io.restaurantos.finance.feign;

import io.restaurantos.finance.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.time.LocalDate;

@FeignClient(
        name = "purchasing-service",
        configuration = FeignClientConfig.class,
        fallback = PurchasingInternalClientFallback.class
)
public interface PurchasingInternalClient {

    @GetMapping("/internal/invoices/unmatched-count")
    long getUnmatchedInvoiceCount(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd
    );
}
