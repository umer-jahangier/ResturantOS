package io.restaurantos.authz.integration;

import io.jsonwebtoken.Jwts;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class TestFixtures {

    public static final String KID = "test-key-1";

    public static final UUID DEMO_TENANT_ID = UUID.fromString("a0000001-0000-4000-8000-000000000001");
    public static final UUID MAIN_BRANCH_ID = UUID.fromString("b0000001-0000-4000-8000-000000000001");
    public static final UUID BRANCH_2_ID = UUID.fromString("b0000002-0000-4000-8000-000000000002");
    public static final UUID OTHER_TENANT_ID = UUID.fromString("c0000003-0000-4000-8000-000000000003");
    public static final UUID CASHIER_USER_ID = UUID.fromString("c0000001-0000-4000-8000-000000000001");
    public static final UUID OWNER_USER_ID = UUID.fromString("c0000002-0000-4000-8000-000000000002");

    private static final KeyPair KEYS = generate();

    private TestFixtures() {}

    public static UUID demoTenantId() { return DEMO_TENANT_ID; }
    public static UUID mainBranchId() { return MAIN_BRANCH_ID; }
    public static UUID branch2Id() { return BRANCH_2_ID; }
    public static UUID otherTenantId() { return OTHER_TENANT_ID; }
    public static UUID cashierUserId() { return CASHIER_USER_ID; }
    public static UUID ownerUserId() { return OWNER_USER_ID; }
    public static RSAPublicKey publicKey() { return (RSAPublicKey) KEYS.getPublic(); }

    public static String mintJwt(UUID sub, UUID tenantId, UUID branchId,
                                   List<String> roles, List<String> permissions,
                                   Map<String, Object> attributes) {
        return Jwts.builder()
            .header().add("kid", KID).and()
            .subject(sub.toString())
            .claim("tenant_id", tenantId.toString())
            .claim("branch_id", branchId.toString())
            .claim("roles", roles)
            .claim("permissions", permissions)
            .claim("attributes", attributes != null ? attributes : Map.of())
            .issuedAt(new Date())
            .expiration(new Date(System.currentTimeMillis() + 900_000))
            .signWith((RSAPrivateKey) KEYS.getPrivate())
            .compact();
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
