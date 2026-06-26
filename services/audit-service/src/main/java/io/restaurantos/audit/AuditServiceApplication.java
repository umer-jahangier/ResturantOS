package io.restaurantos.audit;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

// NOTE: No @EnableJpaAuditing — SharedAutoConfiguration is authoritative [03-02-D]
@SpringBootApplication
@EnableDiscoveryClient
@EnableScheduling
@EntityScan(basePackages = {"io.restaurantos.audit.entity", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.audit.repository", "io.restaurantos.shared"})
public class AuditServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(AuditServiceApplication.class, args);
    }
}
