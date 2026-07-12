package io.restaurantos.pos.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI posOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("POS Service API")
                        .description("Point of Sale — Menu, Tables, Orders, and Kitchen Display")
                        .version("1.0.0"));
    }
}
