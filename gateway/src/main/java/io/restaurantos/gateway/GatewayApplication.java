package io.restaurantos.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

/**
 * API Gateway — reactive Spring Cloud Gateway WebFlux edge service.
 *
 * <p>JPA and shared-lib's SharedAutoConfiguration are excluded because:
 * <ul>
 *   <li>The gateway is a pure reactive WebFlux service with no database persistence.</li>
 *   <li>SharedAutoConfiguration requires EntityManager (JPA) and WebMvcConfigurer (servlet),
 *       neither of which is compatible with a reactive gateway.</li>
 * </ul>
 * The gateway only uses plain security classes from shared-lib
 * ({@code JwksKeyProvider}, {@code JwtClaims}).
 */
@SpringBootApplication(exclude = {
        org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration.class,
        org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration.class,
        io.restaurantos.shared.config.SharedAutoConfiguration.class,
        io.restaurantos.shared.config.TenantDataSourceAutoConfiguration.class
})
@EnableDiscoveryClient
public class GatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
