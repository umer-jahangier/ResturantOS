package io.restaurantos.file;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * File service entry point. Provides tenant-scoped file storage via MinIO.
 * NOTE: @EnableJpaAuditing is intentionally absent — SharedAutoConfiguration is authoritative [03-02-D].
 */
@SpringBootApplication
@EnableDiscoveryClient
@EnableFeignClients(basePackages = "io.restaurantos.file.client")
@EntityScan(basePackages = {"io.restaurantos.file.entity", "io.restaurantos.shared"})
@EnableJpaRepositories(basePackages = {"io.restaurantos.file.repository", "io.restaurantos.shared"})
public class FileServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(FileServiceApplication.class, args);
    }
}
