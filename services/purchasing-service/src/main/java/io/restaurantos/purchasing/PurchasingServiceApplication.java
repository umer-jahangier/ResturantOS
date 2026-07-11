package io.restaurantos.purchasing;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@SpringBootApplication
@EnableFeignClients(basePackages = "io.restaurantos.purchasing.feign")
@EntityScan(basePackages = {"io.restaurantos.purchasing.domain.model", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.purchasing.repository", "io.restaurantos.shared"})
public class PurchasingServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(PurchasingServiceApplication.class, args);
    }
}
