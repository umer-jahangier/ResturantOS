package io.restaurantos.audit;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

// NOTE: No @EnableJpaAuditing — SharedAutoConfiguration is authoritative [03-02-D]
@SpringBootApplication
@EnableDiscoveryClient
@EnableScheduling
// F4: the audit read path resolves actor ids to names over auth-service's internal user endpoint.
// Without this the @FeignClient interface is an interface and nothing else — no proxy is created,
// the context fails to start naming AuthUserDirectoryClient, which is the loud failure this
// annotation being missing should produce and does.
@EnableFeignClients(basePackages = "io.restaurantos.audit.feign")
@EntityScan(basePackages = {"io.restaurantos.audit.entity", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.audit.repository", "io.restaurantos.shared"})
public class AuditServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(AuditServiceApplication.class, args);
    }
}
