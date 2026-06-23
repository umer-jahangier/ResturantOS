package io.restaurantos.auth.controller;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import io.restaurantos.auth.config.AuthJwtProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.security.interfaces.RSAPublicKey;
import java.util.Map;

@RestController
public class JwksController {

    private final RSAPublicKey publicKey;
    private final AuthJwtProperties jwtProperties;

    public JwksController(RSAPublicKey publicKey, AuthJwtProperties jwtProperties) {
        this.publicKey = publicKey;
        this.jwtProperties = jwtProperties;
    }

    @GetMapping("/.well-known/jwks.json")
    public Map<String, Object> jwks() {
        RSAKey jwk = new RSAKey.Builder(publicKey)
            .keyID(jwtProperties.getPublicKeyId())
            .keyUse(KeyUse.SIGNATURE)
            .algorithm(JWSAlgorithm.RS256)
            .build();
        return new JWKSet(jwk).toJSONObject(true);
    }
}
