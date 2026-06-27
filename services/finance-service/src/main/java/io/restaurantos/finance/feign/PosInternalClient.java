package io.restaurantos.finance.feign;

import io.restaurantos.finance.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.time.LocalDate;

@FeignClient(
        name = "pos-service",
        configuration = FeignClientConfig.class,
        fallback = PosInternalClientFallback.class
)
public interface PosInternalClient {

    @GetMapping("/internal/orders/open-count")
    long getOpenOrderCount(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodStart,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd
    );
}
