package io.restaurantos.inventory;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableFeignClients(basePackages = "io.restaurantos.inventory.feign")
@EntityScan(basePackages = {"io.restaurantos.inventory.domain.model", "io.restaurantos.inventory.entity", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.inventory.repository", "io.restaurantos.shared"})
public class InventoryServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(InventoryServiceApplication.class, args);
    }
}
