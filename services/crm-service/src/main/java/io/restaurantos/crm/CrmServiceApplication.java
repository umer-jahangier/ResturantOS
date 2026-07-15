package io.restaurantos.crm;

import org.springframework.amqp.rabbit.annotation.EnableRabbit;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@SpringBootApplication
@EnableDiscoveryClient
@EnableRabbit
@EntityScan(basePackages = {"io.restaurantos.crm.entity", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.crm.repository", "io.restaurantos.shared"})
public class CrmServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(CrmServiceApplication.class, args);
    }
}
