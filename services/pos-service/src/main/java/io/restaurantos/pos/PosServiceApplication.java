package io.restaurantos.pos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

// NOTE: No @EnableJpaAuditing — SharedAutoConfiguration is authoritative [03-02-D].
@SpringBootApplication
@EnableFeignClients(basePackages = "io.restaurantos.pos.feign")
@EntityScan(basePackages = {"io.restaurantos.pos.domain.model", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.pos.repository", "io.restaurantos.shared"})
public class PosServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(PosServiceApplication.class, args);
    }
}
