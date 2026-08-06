package io.restaurantos.hr;

import org.springframework.amqp.rabbit.annotation.EnableRabbit;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

// NOTE: No @EnableJpaAuditing — SharedAutoConfiguration is authoritative [03-02-D].
// It declares @EnableJpaAuditing(auditorAwareRef = "tenantContextAuditorAware"); declaring a second,
// unqualified one here registered a competing jpaAuditingHandler and every hr-service integration
// test died at context load with BeanDefinitionOverrideException — which is why none of them ever
// ran, and why four blockers reached review. pos-service and finance-service carry this same note.
@SpringBootApplication
@EnableDiscoveryClient
@EnableRabbit
@EnableScheduling
@EntityScan(basePackages = {"io.restaurantos.hr.entity", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.hr.repository", "io.restaurantos.shared"})
public class HrServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(HrServiceApplication.class, args);
    }
}
