package io.restaurantos.authz.integration;

import io.restaurantos.shared.security.JwksKeyProvider;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.security.interfaces.RSAPublicKey;

@TestConfiguration
public class TestJwksConfig {

    @Bean
    @Primary
    public JwksKeyProvider jwksKeyProvider() {
        return new JwksKeyProvider(TestFixtures.KID, (RSAPublicKey) TestFixtures.publicKey());
    }
}
