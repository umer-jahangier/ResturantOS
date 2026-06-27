package io.restaurantos.auth.config;

import io.restaurantos.shared.security.JwtAuthenticationFilter;
import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;

@Configuration
@EnableConfigurationProperties({AuthJwtProperties.class, AuthCookieProperties.class, EncryptionProperties.class})
public class JwtSigningConfig {

    @Bean
    RSAPrivateKey rsaPrivateKey(AuthJwtProperties props) {
        return RsaKeyLoader.loadPrivateKey(props.getPrivateKeyBase64());
    }

    @Bean
    RSAPublicKey rsaPublicKey(AuthJwtProperties props) {
        return RsaKeyLoader.loadPublicKey(props.getPublicKeyBase64());
    }

    @Bean
    JwksKeyProvider jwksKeyProvider(AuthJwtProperties props, RSAPublicKey rsaPublicKey) {
        return new JwksKeyProvider(props.getPublicKeyId(), rsaPublicKey);
    }

    @Bean
    JwtAuthenticationFilter jwtAuthenticationFilter(JwksKeyProvider jwksKeyProvider, TenantContext tenantContext) {
        return new JwtAuthenticationFilter(jwksKeyProvider, tenantContext);
    }
}
