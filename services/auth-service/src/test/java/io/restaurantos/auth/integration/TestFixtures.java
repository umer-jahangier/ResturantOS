package io.restaurantos.auth.integration;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

public final class TestFixtures {

    public static final UUID DEMO_TENANT_ID = UUID.fromString("a0000001-0000-4000-8000-000000000001");
    public static final UUID MAIN_BRANCH_ID = UUID.fromString("b0000001-0000-4000-8000-000000000001");
    public static final UUID BRANCH_2_ID = UUID.fromString("b0000002-0000-4000-8000-000000000002");
    public static final UUID CASHIER_USER_ID = UUID.fromString("c0000001-0000-4000-8000-000000000001");
    public static final UUID OWNER_USER_ID = UUID.fromString("c0000002-0000-4000-8000-000000000002");
    public static final UUID ACCOUNTANT_USER_ID = UUID.fromString("c0000003-0000-4000-8000-000000000003");

    public static final String CASHIER_EMAIL = "cashier@demo.local";
    public static final String CASHIER_PASSWORD = "Cashier#2026";
    public static final String OWNER_EMAIL = "owner@demo.local";
    public static final String OWNER_PASSWORD = "Owner#2026";
    public static final String ACCOUNTANT_EMAIL = "accountant@demo.local";
    public static final String ACCOUNTANT_PASSWORD = "Accountant#2026";
    public static final String DEMO_SLUG = "demo";

    private static final KeyPair KEYS = generate();

    private TestFixtures() {}

    public static UUID demoTenantId() { return DEMO_TENANT_ID; }
    public static UUID mainBranchId() { return MAIN_BRANCH_ID; }
    public static UUID branch2Id() { return BRANCH_2_ID; }
    public static UUID cashierUserId() { return CASHIER_USER_ID; }
    public static UUID ownerUserId() { return OWNER_USER_ID; }
    public static KeyPair keys() { return KEYS; }

    public static String fieldEncryptionKeyBase64() {
        byte[] keyBytes = new byte[32];
        for (int i = 0; i < keyBytes.length; i++) {
            keyBytes[i] = (byte) i;
        }
        return Base64.getEncoder().encodeToString(keyBytes);
    }

    public static String privateKeyBase64() {
        return Base64.getEncoder().encodeToString(KEYS.getPrivate().getEncoded());
    }

    public static String publicKeyBase64() {
        return Base64.getEncoder().encodeToString(KEYS.getPublic().getEncoded());
    }

    public static Map<String, Object> loginBody(String email, String password, String tenantSlug) {
        return Map.of("email", email, "password", password, "tenantSlug", tenantSlug);
    }

    public static Map<String, Object> loginBody(String email, String password, String tenantSlug, String totpCode) {
        return Map.of("email", email, "password", password, "tenantSlug", tenantSlug, "totpCode", totpCode);
    }

    private static KeyPair generate() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
