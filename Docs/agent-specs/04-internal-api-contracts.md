# RestaurantOS — Document 4: Internal API Contracts

> Defines every `/internal/*` endpoint that services expose for other services via OpenFeign. These are NOT in the public API and are NOT routed through the gateway. All request/response bodies are JSON; field names are `camelCase`; money is `long` paisa.

## 4.1 Internal Endpoint Convention

Two requirements apply to EVERY `/internal/*` endpoint:

1. **JWT** — internal endpoints require the same `Authorization: Bearer <access-jwt>` as public endpoints. The receiving service validates signature/expiry and re-derives `tenant_id` from the JWT (it does NOT trust a tenant id from the path or body). A service-to-service call propagates the original caller's JWT. For server-initiated flows with no user JWT (provisioning, the outbox relay), the calling service uses a short-lived **service JWT** minted by Auth with `sub=<service-name>` and `roles=["INTERNAL_SERVICE"]`.

2. **`X-Internal-Service` header** — a shared secret (`INTERNAL_SERVICE_SECRET`, from Config/Vault) proving the caller is an internal service. Compared in constant time; 403 if absent/wrong. The gateway STRIPS any inbound `X-Internal-Service` header from public traffic.

Anti-pattern (WRONG — trusting `X-Tenant-Id` without JWT re-validation; cross-tenant escalation):

```java
@PostMapping("/internal/journal-entries")
public void post(@RequestHeader("X-Tenant-Id") UUID tenantId, @RequestBody JournalEntryRequest req) { ... }
```

Correct: the receiving service ignores any tenant header and uses the validated JWT via `TenantContext.requireTenantId()`.

Convention summary: all internal paths are prefixed `/internal/`; internal endpoints are excluded from the gateway route table (gateway forwards only `/api/v1/**`); internal endpoints return the same `ApiResponse<T>` envelope.

## 4.2 Per-Service Internal Endpoints

### Auth Service (`auth-service`, `http://auth-service:8081`)

| Method + Path | Request | Response | Called by |
|---|---|---|---|
| `POST /internal/auth/verify-token` | `{ "token": string }` | `{ "valid": bool, "claims": JwtClaims }` | Gateway, any service |
| `GET /internal/auth/users/{userId}/permissions?branchId=` | path+query | `{ "branchId": UUID, "roles": string[], "permissions": string[], "attributes": object }` | user-service, OPA-using services |
| `POST /internal/auth/users/{userId}/branch-roles` | `{ "branchId": UUID, "roleCode": string, "approvalLimitPaisa": long? }` + `X-Tenant-Id` | `UserBranchRoleEntity` (200 OK) | user-service `UserAdminService` |
| `DELETE /internal/auth/users/{userId}/branch-roles?branchId=&roleCode=` | query + `X-Tenant-Id` | 204 No Content | user-service `UserAdminService` |
| `GET /internal/auth/users?branchId={branchId}&roleCode={roleCode}` | query | `{ "users": [{ "userId", "email", "fullName" }] }` | Notification |
| `POST /internal/auth/tenants/{tenantId}/provision-admin` | `{ "email": string }` | `{ "userId": UUID, "tempPassword": string }` | Platform Admin (FD-1) |
| `POST /internal/auth/service-token` | `{ "service": string }` | `{ "token": string, "expiresIn": 300 }` | any service |

> **§4.2 security note (03-03):** All `/internal/auth/**` endpoints require `X-Internal-Service: {restaurantos.internal.secret}` header, enforced by `InternalServiceFilter` (constant-time comparison). Branch-role write endpoints additionally require `X-Tenant-Id` for RLS scoping. `auth-service` is the **system of record** for `user_branch_roles`; no other service writes this table directly.

```java
package io.restaurantos.notification.client;

import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
import java.util.UUID;

@FeignClient(name = "auth-service", configuration = io.restaurantos.shared.config.FeignSharedConfig.class)
public interface AuthClient {
    @GetMapping("/internal/auth/users")
    ApiResponse<List<UserSummary>> getUsersByBranchAndRole(@RequestParam UUID branchId, @RequestParam String roleCode);
    record UserSummary(UUID userId, String email, String fullName) {}
}
```

### User Service (`user-service`, `http://user-service:8082`)

| Method + Path | Request | Response | Called by |
|---|---|---|---|
| `POST /internal/users/branches` | `{ "tenantId": UUID, "name": string, "isHq": bool }` | `{ "branchId": UUID }` (201) | Platform Admin FD-1 (step 4) |
| `GET /internal/users/branches/{branchId}` | path + optional `X-Tenant-Id` | `BranchEntity` JSON | POS, Finance, Reporting |
| `GET /internal/users/tenants/{tenantId}/branches` | path | `[ BranchEntity ]` | Reporting, Platform Admin |
| `GET /internal/users/{userId}/profile` | path | `{ "userId", "fullName", "email", "locale", "branchIds": UUID[] }` | Notification, HR (planned) |

> **§4.2 note (03-03):** All `/internal/users/**` endpoints require `X-Internal-Service` header (same contract as auth-service). user-service does **not** own `user_branch_roles` and never writes it; all role operations are delegated to `/internal/auth/**` via `AuthInternalClient` (Feign).

### Inventory Service (`inventory-service`, `http://inventory-service:8085`)

| Method + Path | Request | Response | Called by |
|---|---|---|---|
| `GET /internal/inventory/branches/{branchId}/stock-levels?ingredientIds=` | query | `{ "levels": [{ "ingredientId", "qtyOnHand", "avgCostPaisa" }] }` | Reporting, Purchasing |
| `POST /internal/inventory/availability-check` | `{ "branchId", "items": [{ "menuItemId", "qty" }] }` | `{ "results": [{ "menuItemId", "available": bool, "shortIngredients": [UUID] }] }` | POS |

### Finance Service (`finance-service`, `http://finance-service:8086`)

| Method + Path | Request | Response | Called by |
|---|---|---|---|
| `POST /internal/finance/journal-entries` | `{ "branchId", "entryDate", "description", "sourceType", "sourceId", "lines": [{ "accountCode", "debitPaisa", "creditPaisa", "description" }] }` | `{ "jeId", "entryNo" }` | synchronous corrections |
| `GET /internal/finance/periods/status?branchId=&date=` | query | `{ "periodId", "status": "OPEN\|LOCKED\|CLOSED", "fiscalYear", "periodNo" }` | POS, HR, Purchasing |

### Platform Admin Service (`platform-admin-service`, `http://platform-admin-service:8080`)

| Method + Path | Request | Response | Called by |
|---|---|---|---|
| `GET /internal/platform/tenants/{tenantId}/features` | path | `{ "features": { "FEATURE_HR": bool, ... } }` | Gateway, FeatureFlagService |
| `GET /internal/platform/tenants/{tenantId}/status` | path | `{ "status": "ACTIVE\|SUSPENDED\|...", "tier" }` | Gateway |
| `POST /internal/platform/tenants/{tenantId}/usage` | `{ "resource": string, "delta": number }` | `{ "newCount": number, "limit": number }` | NLQ, User, File |

### POS Service (`pos-service`, `http://pos-service:8084`) — resolves CRIT-05

| Method + Path | Request | Response | Called by |
|---|---|---|---|
| `GET /internal/pos/branches/{branchId}/open-orders-count?olderThanHours=12` | path+query | `{ "count": number }` | Finance (period close) |

### Purchasing Service (`purchasing-service`, `http://purchasing-service:8087`) — resolves CRIT-05

| Method + Path | Request | Response | Called by |
|---|---|---|---|
| `GET /internal/purchasing/branches/{branchId}/open-receipts` | path | `{ "count": number, "poIds": [UUID] }` | Finance (period close) |
| `GET /internal/purchasing/branches/{branchId}/pending-match-invoices?olderThanHours=48` | path+query | `{ "count": number, "invoiceIds": [UUID] }` | Finance (period close) |

Finance's period-close OpenFeign clients:

```java
package io.restaurantos.finance.client;

import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
import java.util.UUID;

@FeignClient(name = "pos-service", configuration = io.restaurantos.shared.config.FeignSharedConfig.class)
public interface PosClient {
    @GetMapping("/internal/pos/branches/{branchId}/open-orders-count")
    ApiResponse<OpenOrdersCount> openOrdersCount(@PathVariable UUID branchId, @RequestParam("olderThanHours") int olderThanHours);
    record OpenOrdersCount(long count) {}
}

@FeignClient(name = "purchasing-service", configuration = io.restaurantos.shared.config.FeignSharedConfig.class)
interface PurchasingClient {
    @GetMapping("/internal/purchasing/branches/{branchId}/open-receipts")
    ApiResponse<OpenReceipts> openReceipts(@PathVariable UUID branchId);
    @GetMapping("/internal/purchasing/branches/{branchId}/pending-match-invoices")
    ApiResponse<PendingInvoices> pendingMatch(@PathVariable UUID branchId, @RequestParam("olderThanHours") int olderThanHours);
    record OpenReceipts(long count, List<UUID> poIds) {}
    record PendingInvoices(long count, List<UUID> invoiceIds) {}
}
```

The Finance period-close service aggregates these three internal calls instead of querying `pos_db`/`purchasing_db` directly (the CRIT-05 fix).

## 4.3 OpenFeign Client Configuration

Base config in `shared-lib`, referenced by every `@FeignClient`. Sets timeouts, the error decoder, and a request interceptor that propagates JWT, correlation id, and the `X-Internal-Service` secret.

```java
package io.restaurantos.shared.config;

import feign.Request;
import feign.RequestInterceptor;
import feign.Retryer;
import feign.codec.ErrorDecoder;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.concurrent.TimeUnit;

public class FeignSharedConfig {

    @Value("${restaurantos.internal.service-secret}")
    private String internalServiceSecret;

    @Bean
    public Request.Options feignOptions() {
        return new Request.Options(2, TimeUnit.SECONDS, 10, TimeUnit.SECONDS, true);
    }

    @Bean
    public Retryer feignRetryer() { return Retryer.NEVER_RETRY; }

    @Bean
    public RequestInterceptor internalRequestInterceptor() {
        return template -> {
            ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs != null) {
                String auth = attrs.getRequest().getHeader("Authorization");
                if (auth != null) template.header("Authorization", auth);
            }
            String traceId = MDC.get("traceId");
            if (traceId != null) template.header("X-Correlation-Id", traceId);
            template.header("X-Internal-Service", internalServiceSecret);
        };
    }

    @Bean
    public ErrorDecoder feignErrorDecoder() { return new InternalFeignErrorDecoder(); }
}
```

```java
package io.restaurantos.shared.config;

import feign.Response;
import feign.codec.ErrorDecoder;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;

import java.util.UUID;

public class InternalFeignErrorDecoder implements ErrorDecoder {
    private final ErrorDecoder defaultDecoder = new Default();
    @Override
    public Exception decode(String methodKey, Response response) {
        return switch (response.status()) {
            case 403 -> new PermissionDeniedException("Internal call denied: " + methodKey);
            case 404 -> new ResourceNotFoundException("InternalResource", UUID.randomUUID());
            default -> defaultDecoder.decode(methodKey, response);
        };
    }
}
```

Full client example (Inventory client used by Reporting):

```java
package io.restaurantos.reporting.client;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.config.FeignSharedConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
import java.util.UUID;

@FeignClient(name = "inventory-service", path = "/internal/inventory", configuration = FeignSharedConfig.class)
public interface InventoryClient {
    @GetMapping("/branches/{branchId}/stock-levels")
    ApiResponse<StockLevels> stockLevels(@PathVariable UUID branchId, @RequestParam("ingredientIds") List<UUID> ingredientIds);
    record StockLevels(List<Level> levels) {
        public record Level(UUID ingredientId, double qtyOnHand, long avgCostPaisa) {}
    }
}
```

Enable Feign in each service's application class:

```java
@SpringBootApplication
@EnableFeignClients(basePackages = "io.restaurantos.reporting.client")
public class ReportingServiceApplication {
    public static void main(String[] args) { SpringApplication.run(ReportingServiceApplication.class, args); }
}
```
