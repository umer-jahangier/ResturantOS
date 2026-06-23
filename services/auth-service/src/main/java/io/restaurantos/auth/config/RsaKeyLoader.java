package io.restaurantos.auth.config;

import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

final class RsaKeyLoader {

    private RsaKeyLoader() {}

    static RSAPrivateKey loadPrivateKey(String base64Pem) {
        byte[] der = decodePem(base64Pem);
        try {
            return (RSAPrivateKey) KeyFactory.getInstance("RSA")
                .generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse RSA private key", e);
        }
    }

    static RSAPublicKey loadPublicKey(String base64Pem) {
        byte[] der = decodePem(base64Pem);
        try {
            return (RSAPublicKey) KeyFactory.getInstance("RSA")
                .generatePublic(new X509EncodedKeySpec(der));
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse RSA public key", e);
        }
    }

    private static byte[] decodePem(String base64Pem) {
        String normalized = base64Pem.replaceAll("\\s", "");
        byte[] decoded = Base64.getDecoder().decode(normalized);
        String pem = new String(decoded);
        if (pem.contains("BEGIN")) {
            String stripped = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s", "");
            return Base64.getDecoder().decode(stripped);
        }
        return decoded;
    }
}
