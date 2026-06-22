# RestaurantOS — Document 10: Test Architecture Guide

> All agents write tests using the same infrastructure setup. Java tests use JUnit 5 + Testcontainers; frontend uses Vitest + MSW; OPA uses `opa test`.

## 10.1 Base Testcontainers Configuration

`BaseIntegrationTest` lives in each service's `src/test/java/io/restaurantos/{svc}/integration/`. It starts PostgreSQL, Redis, and RabbitMQ once per JVM, runs Liquibase on context start, and sets the test tenant context before each test.

```java
package io.restaurantos.pos.integration;

import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@Testcontainers
public abstract class BaseIntegrationTest {

    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>(DockerImageName.parse("postgres:18.4"))
            .withDatabaseName("pos_db").withUsername("pos_user").withPassword("test-pass");
    static final GenericContainer<?> REDIS =
        new GenericContainer<>(DockerImageName.parse("redis:8.2")).withExposedPorts(6379);
    static final RabbitMQContainer RABBIT =
        new RabbitMQContainer(DockerImageName.parse("rabbitmq:4.3-management"));

    static { POSTGRES.start(); REDIS.start(); RABBIT.start(); }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.liquibase.change-log", () -> "classpath:db/changelog/db.changelog-master.xml");
        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> RABBIT.getAmqpPort().toString());
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
    }

    @Autowired protected TenantContext tenantContext;

    @BeforeEach
    void setTenant() {
        tenantContext.set(TestFixtures.testTenantId(), TestFixtures.testBranchId(), TestFixtures.testUserId(), null);
    }

    @AfterEach
    void clearTenant() { tenantContext.clear(); }
}
```

Because RLS is `FORCE`d, repository tests must set `app.current_tenant_id`:

```java
@BeforeEach
void setRls(@Autowired jakarta.persistence.EntityManager em) {
    em.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, false)")
      .setParameter("tid", TestFixtures.testTenantId().toString())
      .getSingleResult();
}
```

## 10.2 Test Tenant and User Fixtures

`TestFixtures` builds JWTs locally (signed with a test RSA key) without calling the Auth Service.

```java
package io.restaurantos.pos.integration;

import io.jsonwebtoken.Jwts;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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
```

Tests inject the JWT into MockMvc via the `Authorization: Bearer` header; the test security config trusts `TestFixtures.keys().getPublic()` as the JWKS key.

## 10.3 RabbitMQ Consumer Testing Pattern

Publish a test envelope, wait for processing, assert DB state. Uses the real RabbitMQ Testcontainer.

```java
package io.restaurantos.inventory.integration;

import io.restaurantos.shared.event.EventEnvelope;
import org.awaitility.Awaitility;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class DepletionConsumerIT extends BaseIntegrationTest {

    @Autowired RabbitTemplate rabbitTemplate;
    @Autowired IngredientBranchStockRepository stockRepo;

    @Test
    void orderClosed_depletesStock() {
        UUID ingredientId = InventoryFixtures.seedRiceWithStock(stockRepo, 10.0);
        var payload = new OrderClosedPayload(UUID.randomUUID(),
            List.of(new OrderClosedPayload.Item(InventoryFixtures.menuItemId(), "Rice Plate", 2)));
        var env = new EventEnvelope<>(UUID.randomUUID(), "ORDER_CLOSED",
            testTenantId(), testBranchId(), Instant.now(), UUID.randomUUID(), 1, "POS_SERVICE", payload);

        rabbitTemplate.convertAndSend("pos.topic", "pos.order.closed", env);

        Awaitility.await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
            var stock = stockRepo.findByBranchIdAndIngredientId(testBranchId(), ingredientId).orElseThrow();
            assertThat(stock.getQtyOnHand()).isLessThan(java.math.BigDecimal.valueOf(10.0));
        });
    }
}
```

## 10.4 OPA Policy Testing

`opa test policies/ -v`. CI enforces 100% coverage: `opa test policies/ --coverage --format=json | jq '.coverage'` must be `100`.

`policies/tests/pos_test.rego`:

```rego
package restaurantos.pos

import data.restaurantos.pos

test_cashier_voids_own_open_order {
    pos.allow with input as {
        "user": {"id": "u1", "tenant_id": "t1", "branch_id": "b1", "permissions": ["pos.order.void.own"], "attributes": {}},
        "resource": {"type": "Order", "id": "o1", "tenant_id": "t1", "branch_id": "b1", "created_by": "u1", "status": "OPEN"},
        "action": "void"
    }
}

test_cashier_cannot_void_others_order {
    not pos.allow with input as {
        "user": {"id": "u1", "tenant_id": "t1", "branch_id": "b1", "permissions": ["pos.order.void.own"], "attributes": {}},
        "resource": {"type": "Order", "id": "o1", "tenant_id": "t1", "branch_id": "b1", "created_by": "u2", "status": "OPEN"},
        "action": "void"
    }
}

test_cross_branch_denied {
    not pos.allow with input as {
        "user": {"id": "u1", "tenant_id": "t1", "branch_id": "b1", "permissions": ["pos.order.void.any"], "attributes": {}},
        "resource": {"type": "Order", "id": "o1", "tenant_id": "t1", "branch_id": "b2", "created_by": "u9", "status": "OPEN"},
        "action": "void"
    }
}
```

## 10.5 Frontend MSW Handler Structure

```
frontend/src/__mocks__/
├── handlers/
│   ├── orders.ts
│   └── index.ts
├── server.ts
└── browser.ts
```

`handlers/orders.ts`:

```typescript
import { http, HttpResponse } from "msw";

export const orderHandlers = [
  http.get("/api/v1/orders/:id", ({ params }) =>
    HttpResponse.json({
      data: {
        id: params.id,
        tenant_id: "11111111-1111-1111-1111-111111111111",
        branch_id: "22222222-2222-2222-2222-222222222222",
        order_no: "ORD-20260429-0001",
        type: "DINE_IN",
        status: "OPEN",
        subtotal_paisa: 80000, tax_paisa: 5600, discount_paisa: 0,
        service_charge_paisa: 0, total_paisa: 85600,
        items: [], opened_at: "2026-04-29T08:00:00Z",
      },
    })
  ),
];
```

`server.ts`:

```typescript
import { setupServer } from "msw/node";
import { orderHandlers } from "./handlers/orders";
export const server = setupServer(...orderHandlers);
```

`__tests__/utils/query-wrapper.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

export function createQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
```

## 10.6 Contract Test Pattern

Mock the API with MSW, call the repository, assert the Zod schema parses and the adapter produces the correct domain model. When the schema does not match, the test fails loudly (ZodError).

```tsx
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { server } from "@/__mocks__/server";
import { http, HttpResponse } from "msw";
import { OrderRepository } from "@/lib/repositories/order.repository";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("OrderRepository.get contract", () => {
  it("parses and adapts paisa to Money", async () => {
    const order = await OrderRepository.get("order-uuid");
    expect(order.total.paisa).toBe(85600);
    expect(order.total.pkr).toBe(856);
    expect(order.total.formatted).toMatch(/PKR/);
    expect(order.isClosed).toBe(false);
  });

  it("fails loudly when the API renames a field", async () => {
    server.use(
      http.get("/api/v1/orders/:id", () =>
        HttpResponse.json({
          data: {
            id: "order-uuid", tenant_id: "11...", branch_id: "22...",
            order_no: "ORD-1", type: "DINE_IN", status: "OPEN",
            subtotal_paisa: 80000, tax_paisa: 5600, discount_paisa: 0,
            service_charge_paisa: 0,
            grand_total_paisa: 85600,        // renamed from total_paisa
            items: [], opened_at: "2026-04-29T08:00:00Z",
          },
        })
      )
    );
    await expect(OrderRepository.get("order-uuid")).rejects.toThrowError(/total_paisa/i);
  });
});
```

## 10.7 Coverage Requirements Table

Enforced in CI via `mvn verify -Pcoverage` (JaCoCo), `vitest run --coverage`, and `opa test --coverage`. The build fails if any module is below threshold.

| Module / Area | Min line coverage | Enforced by |
|---|---|---|
| `finance-service` | 75% | `mvn verify -Pcoverage` |
| `inventory-service` | 75% | `mvn verify -Pcoverage` |
| `pos-service` | 70% | `mvn verify -Pcoverage` |
| `auth-service`, `authorization-service` | 70% | `mvn verify -Pcoverage` |
| all other Java services | 60% | `mvn verify -Pcoverage` |
| `shared-lib` | 70% | `mvn verify -Pcoverage` |
| OPA policies | 100% | `opa test policies/ --coverage` |
| frontend (repositories/adapters/hooks) | 70% | `vitest run --coverage` |

JaCoCo `check` (in each service `pom.xml`, `coverage` profile):

```xml
<profile>
  <id>coverage</id>
  <build><plugins>
    <plugin>
      <groupId>org.jacoco</groupId>
      <artifactId>jacoco-maven-plugin</artifactId>
      <version>0.8.12</version>
      <executions>
        <execution><goals><goal>prepare-agent</goal></goals></execution>
        <execution>
          <id>check</id><phase>verify</phase><goals><goal>check</goal></goals>
          <configuration><rules><rule>
            <element>BUNDLE</element>
            <limits><limit>
              <counter>LINE</counter><value>COVEREDRATIO</value><minimum>0.75</minimum>
            </limit></limits>
          </rule></rules></configuration>
        </execution>
      </executions>
    </plugin>
  </plugins></build>
</profile>
```
