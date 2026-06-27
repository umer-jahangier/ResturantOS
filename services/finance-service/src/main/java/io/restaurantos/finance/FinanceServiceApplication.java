package io.restaurantos.finance;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

// NOTE: No @EnableJpaAuditing — SharedAutoConfiguration is authoritative [03-02-D].
// Both scans include io.restaurantos.shared so the shared Outbox/Idempotency entities and
// repositories resolve and Spring Data JPA registers the shared EntityManager bean that
// SharedAutoConfiguration's TenantFilterInterceptor depends on.
@SpringBootApplication
@EnableFeignClients(basePackages = "io.restaurantos.finance.feign")
@EntityScan(basePackages = {"io.restaurantos.finance.domain.model", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.finance.repository", "io.restaurantos.shared"})
public class FinanceServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(FinanceServiceApplication.class, args);
    }
}
