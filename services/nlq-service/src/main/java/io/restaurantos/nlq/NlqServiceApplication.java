package io.restaurantos.nlq;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@SpringBootApplication
@EnableFeignClients(basePackages = "io.restaurantos.nlq.feign")
// Scoped to the whole io.restaurantos.nlq base package (NOT just domain.model/repository) —
// @Entity/@Repository types live in feature packages (allowlist, audit), not a central
// domain.model/repository package. A narrower scan silently drops AllowedTableRepository /
// NlqQueryLogRepository from the context (found while wiring 12-07's Spring beans).
@EntityScan(basePackages = {"io.restaurantos.nlq", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.nlq", "io.restaurantos.shared"})
public class NlqServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(NlqServiceApplication.class, args);
    }
}
