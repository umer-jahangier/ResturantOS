package io.restaurantos.nlq;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@SpringBootApplication
@EnableFeignClients(basePackages = "io.restaurantos.nlq.feign")
@EntityScan(basePackages = {"io.restaurantos.nlq.domain.model", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.nlq.repository", "io.restaurantos.shared"})
public class NlqServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(NlqServiceApplication.class, args);
    }
}
