package io.restaurantos.reporting;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableFeignClients(basePackages = "io.restaurantos.reporting.feign")
@EntityScan(basePackages = {"io.restaurantos.reporting.domain.model", "io.restaurantos.reporting.entity", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.reporting.repository", "io.restaurantos.shared"})
// Backs DashboardTileService's trailing-edge-flush sweeper (12-06) — the throttle's
// leading-push-plus-trailing-flush contract requires a periodic tick to guarantee convergence.
@EnableScheduling
public class ReportingServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(ReportingServiceApplication.class, args);
    }
}
