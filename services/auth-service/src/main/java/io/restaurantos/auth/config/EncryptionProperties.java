package io.restaurantos.auth.config;

import jakarta.annotation.PostConstruct;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Binds {@code restaurantos.encryption.*} from application.yml.
 *
 * <p>The {@code key} value maps to the {@code FIELD_ENCRYPTION_KEY} environment variable.
 * A {@link PostConstruct} guard prevents the service from starting with a blank key or
 * one shorter than 32 bytes (minimum for AES-256 field encryption).
 */
@ConfigurationProperties(prefix = "restaurantos.encryption")
public class EncryptionProperties {

    private static final int MIN_KEY_BYTES = 32;

    private String key = "";

    public String getKey() {
        return key;
    }

    public void setKey(String key) {
        this.key = key;
    }

    @PostConstruct
    public void validate() {
        if (key == null || key.isBlank()) {
            throw new IllegalStateException(
                    "FIELD_ENCRYPTION_KEY must not be blank. " +
                    "Set the FIELD_ENCRYPTION_KEY environment variable (min 32 bytes) before starting auth-service.");
        }
        if (key.getBytes(java.nio.charset.StandardCharsets.UTF_8).length < MIN_KEY_BYTES) {
            throw new IllegalStateException(
                    "FIELD_ENCRYPTION_KEY is too short: must be at least " + MIN_KEY_BYTES +
                    " bytes (UTF-8). Current length: " +
                    key.getBytes(java.nio.charset.StandardCharsets.UTF_8).length + " bytes.");
        }
    }
}
