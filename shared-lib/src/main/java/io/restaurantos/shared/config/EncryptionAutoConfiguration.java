package io.restaurantos.shared.config;

import io.restaurantos.shared.security.EncryptedStringConverter;
import io.restaurantos.shared.security.EncryptionService;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

@AutoConfiguration
@ConditionalOnProperty(name = "restaurantos.encryption.key")
@EnableConfigurationProperties(EncryptionProperties.class)
public class EncryptionAutoConfiguration {

    @Bean
    public EncryptionService encryptionService(EncryptionProperties properties) {
        EncryptionService service = new EncryptionService(properties.getKey());
        EncryptedStringConverter.init(service);
        return service;
    }
}
