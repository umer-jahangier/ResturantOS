package io.restaurantos.shared.integration;

import io.jsonwebtoken.Jwts;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Test tenant/user constants and JWT generation using a local RSA key pair. */
public final class TestFixtures {

    private static final UUID TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID BRANCH = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID USER   = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final KeyPair KEYS = generate();

    private TestFixtures() {}

    public static UUID testTenantId() { return TENANT; }
    public static UUID testBranchId() { return BRANCH; }
    public static UUID testUserId()   { return USER; }
    public static KeyPair keys()      { return KEYS; }

    public static String testOwnerJwt() {
        return jwt(List.of("OWNER"), List.of("pos.order.create", "pos.order.close",
            "pos.order.void.any", "pos.order.refund", "finance.period.close", "rbac.manage"),
            Map.of("approval_limit_paisa", 100000000L));
    }

    public static String testManagerJwt() {
        return jwt(List.of("BRANCH_MANAGER"), List.of("pos.order.create", "pos.order.close",
            "pos.order.void.any", "pos.order.refund", "pos.order.discount.override"),
            Map.of("approval_limit_paisa", 5000000L));
    }

    public static String testCashierJwt() {
        return jwt(List.of("CASHIER"), List.of("pos.order.create", "pos.order.close",
            "pos.order.void.own", "pos.order.discount.line"), Map.of());
    }

    private static String jwt(List<String> roles, List<String> permissions, Map<String, Object> attrs) {
        Instant now = Instant.now();
        return Jwts.builder()
            .header().keyId("test-key-1").and()
            .subject(USER.toString())
            .claim("tenant_id", TENANT.toString())
            .claim("branch_id", BRANCH.toString())
            .claim("roles", roles)
            .claim("permissions", permissions)
            .claim("attributes", attrs)
            .issuedAt(java.util.Date.from(now))
            .expiration(java.util.Date.from(now.plus(15, ChronoUnit.MINUTES)))
            .signWith(KEYS.getPrivate(), Jwts.SIG.RS256)
            .compact();
    }

    private static KeyPair generate() {
        try {
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048);
            return g.generateKeyPair();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
}
