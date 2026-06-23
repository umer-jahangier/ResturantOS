package io.restaurantos.shared.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EncryptionServiceTest {

    private EncryptionService encryptionService;

    @BeforeEach
    void setUp() {
        byte[] keyBytes = new byte[32];
        for (int i = 0; i < keyBytes.length; i++) {
            keyBytes[i] = (byte) i;
        }
        encryptionService = new EncryptionService(Base64.getEncoder().encodeToString(keyBytes));
    }

    @Test
    void encryptThenDecrypt_returnsOriginalPlaintext() {
        String plaintext = "JBSWY3DPEHPK3PXP";
        byte[] encrypted = encryptionService.encrypt(plaintext);
        assertThat(encryptionService.decrypt(encrypted)).isEqualTo(plaintext);
    }

    @Test
    void encrypt_samePlaintext_producesDifferentCiphertext() {
        String plaintext = "secret-value";
        byte[] first = encryptionService.encrypt(plaintext);
        byte[] second = encryptionService.encrypt(plaintext);
        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void decrypt_tamperedBytes_throws() {
        byte[] encrypted = encryptionService.encrypt("tamper-me");
        encrypted[encrypted.length - 1] ^= 0x01;
        assertThatThrownBy(() -> encryptionService.decrypt(encrypted))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Decryption failed");
    }
}
