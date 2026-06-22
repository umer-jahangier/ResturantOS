# RestaurantOS — Document 7: Coding Standards & Conventions

> All agents must produce code that looks like it was written by one person. Every rule has a correct and (where useful) a wrong example. When in doubt, follow the rule literally.

## 7.1 Java Standards

### 7.1.1 Package and class naming

Base package is `io.restaurantos.{service-name}`. Valid service-name tokens (exhaustive): `platform`, `auth`, `user`, `authz`, `pos`, `inventory`, `finance`, `purchasing`, `hr`, `crm`, `kitchen`, `notification`, `reporting`, `audit`, `file`, `shared`, `gateway`, `configserver`, `eureka`.

Package-layer rule: entities go in `.entity` (never `.model`, never `.domain.entity`); repositories in `.repository`; business logic in `.service`; REST in `.controller`; DTOs in `.dto.request` / `.dto.response`.

| Type | Pattern | Example |
|---|---|---|
| Entity | `{Domain}Entity` | `OrderEntity` |
| Repository | `{Domain}Repository` | `OrderRepository` |
| Service interface | `{Domain}Service` | `OrderService` |
| Service impl | `{Domain}ServiceImpl` | `OrderServiceImpl` |
| Controller | `{Domain}Controller` | `OrderController` |
| Request DTO | `{Domain}{Action}RequestDto` | `OrderCloseRequestDto` |
| Response DTO | `{Domain}ResponseDto` | `OrderResponseDto` |
| Mapper | `{Domain}Mapper` | `OrderMapper` |
| Event listener | `{Domain}EventListener` | `OrderClosedEventListener` |
| Event publisher | `{Domain}EventPublisher` | `OrderEventPublisher` |

Wrong examples and why:
- `Order.java` for a JPA entity — WRONG: missing the `Entity` suffix.
- `io.restaurantos.posservice.OrderEntity` — WRONG: package token must be `pos`, not `posservice`.
- `OrderDTO` — WRONG: use `Dto` (one capital), and split request/response.
- entity in `io.restaurantos.pos.model` — WRONG: must be `.entity`.

### 7.1.2 Dependency injection

Constructor injection only. No field `@Autowired`. Use Lombok `@RequiredArgsConstructor` on `final` fields.

Correct:

```java
@Service
@RequiredArgsConstructor
public class OrderServiceImpl implements OrderService {
    private final OrderRepository orderRepository;
    private final OrderMapper orderMapper;
    private final EventPublisher eventPublisher;
}
```

Wrong:

```java
@Service
public class OrderServiceImpl implements OrderService {
    @Autowired private OrderRepository orderRepository; // WRONG: field injection, not final
}
```

### 7.1.3 Transaction boundaries

`@Transactional` goes on `Service` methods only — never on a controller, never on a repository.

Wrong:

```java
@RestController
public class OrderController {
    @Transactional   // WRONG: no transactions in controllers
    @PostMapping("/orders/{id}/close")
    public ApiResponse<OrderResponseDto> close(...) { /* ... */ }
}
```

### 7.1.4 Exception handling

Throw domain exceptions from the `Service`. The `GlobalExceptionHandler` (in `shared-lib`) is the only place exceptions are caught and mapped to HTTP. No `try/catch` in controllers.

Correct:

```java
if (order.getStatus() != OrderStatus.OPEN) {
    throw new StateInvalidException("Order " + orderId + " is not OPEN");
}
```

```java
@PostMapping("/orders/{id}/close")
public ApiResponse<OrderResponseDto> close(@PathVariable UUID id, @Valid @RequestBody OrderCloseRequestDto body) {
    return ApiResponse.ok(orderService.close(id, body));
}
```

### 7.1.5 Logging

Use Lombok `@Slf4j`. Always include `tenantId` and `traceId` via MDC. Never log passwords, tokens, CNIC, bank accounts, or other PII.

```java
MDC.put("tenantId", claims.tenantId().toString());
MDC.put("traceId", traceId);
try { chain.doFilter(request, response); } finally { MDC.clear(); }
```

Correct: `log.info("Closing order orderId={} totalPaisa={}", orderId, order.getTotalPaisa());`
Wrong: `log.info("login for {} password {}", email, password); // WRONG: logs a secret`

### 7.1.6 Repository methods

Return `Optional<T>` for single-record lookups, `List<T>` for collections, never `null`.

```java
public interface OrderRepository extends JpaRepository<OrderEntity, UUID> {
    Optional<OrderEntity> findByIdAndStatus(UUID id, OrderStatus status);
    List<OrderEntity> findByStatus(OrderStatus status);

    @Query("SELECT o FROM OrderEntity o WHERE o.status = 'OPEN' AND o.openedAt < :cutoff")
    List<OrderEntity> findStaleOpenOrders(@Param("cutoff") Instant cutoff);
}
```

Wrong: `OrderEntity findByOrderNo(String orderNo); // WRONG: return Optional for single lookup`

### 7.1.7 DTO rules

Separate request and response DTOs as Java `record`s. Never return an entity from a controller; never accept an entity as a request body. Use MapStruct for mapping.

```java
public record OrderResponseDto(UUID id, String orderNo, String status, long totalPaisa) {}

@Mapper(componentModel = "spring")
public interface OrderMapper { OrderResponseDto toResponse(OrderEntity entity); }
```

Wrong:

```java
@GetMapping("/orders/{id}")
public OrderEntity get(@PathVariable UUID id) { return orderRepository.findById(id).get(); }
// WRONG: leaks the entity (and lazy proxies, tenant_id, audit fields)
```

### 7.1.8 Validation

Use Jakarta Bean Validation on request DTOs. Define custom validators for business rules.

```java
public record OrderCloseRequestDto(@NotEmpty List<@Valid PaymentDto> payments) {
    public record PaymentDto(@NotNull PaymentMethod method, @PositivePaisa long amountPaisa, String referenceNo) {}
}
```

### 7.1.9 Money

Always `long` for paisa in Java. Never `double`/`float` for money. Display formatting only via `MoneyUtils`.

Correct: `long totalPaisa = subtotalPaisa - discountPaisa + serviceChargePaisa + taxPaisa;`
Wrong: `double total = subtotal / 100.0 * 1.13; // WRONG: float money, ad-hoc tax`

### 7.1.10 Timestamps

Always `Instant` (UTC) in Java. Use `ZonedDateTime` only when converting to `Asia/Karachi` for display. Never `Date` or `Calendar`.

## 7.2 TypeScript / React Standards

### 7.2.1 File naming

| Kind | Pattern | Example | Wrong |
|---|---|---|---|
| Component | `PascalCase.tsx` | `OrderDetail.tsx` | `order-detail.tsx` |
| Hook | `use-kebab-case.ts` | `use-close-order.ts` | `useCloseOrder.ts` |
| Repository | `kebab-case.repository.ts` | `order.repository.ts` | `OrderRepository.ts` |
| Schema | `kebab-case.schema.ts` | `order.schema.ts` | `orderSchema.ts` |
| Adapter | `kebab-case.adapter.ts` | `order.adapter.ts` | `OrderAdapter.ts` |
| Model | `kebab-case.model.ts` | `order.model.ts` | `order.types.ts` |

### 7.2.2 Import ordering

Order: React → third-party → `@/lib/*` → `@/components/*` → relative. Enforced by ESLint `import/order`.

```typescript
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { OrderRepository } from "@/lib/repositories/order.repository";
import { OrderStatusBadge } from "@/components/shared/order-status-badge";
import { formatRelative } from "./utils";
```

### 7.2.3 Component rules

No direct API calls in components. No `axios`/`fetch` imports under `components/`. All data via custom hooks.

```json
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["@/lib/api-client", "@/lib/api-client/*", "@/lib/repositories/*"],
          "message": "Components must use hooks, never the API client or repositories directly." },
        { "group": ["axios"], "message": "Use the shared api-client via repositories/hooks." }
      ]
    }]
  },
  "overrides": [
    { "files": ["src/components/**/*"], "rules": { "no-restricted-imports": "error" } }
  ]
}
```

### 7.2.4 State management

TanStack Query for ALL server state. Zustand ONLY for: auth session, active branch context, offline queue state, UI preferences. Never put server data in Zustand.

### 7.2.5 Money display

Always use `Money.formatted` from the domain model. Never divide paisa by 100 in a component.

Correct: `<p>Total: {order.total.formatted}</p>`
Wrong: `<p>Total: PKR {order.totalPaisa / 100}</p>`

### 7.2.6 TypeScript strictness

Strict mode on. No `any`. No `as` type assertions except inside an adapter with an explanatory comment. No `!` non-null assertions except in test files.

## 7.3 Git Conventions

Commit format: `{type}({scope}): {description}`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
Examples: `feat(pos): add split-tender payment support`, `fix(finance): defer JE balance trigger to commit`.
Branch naming: `{type}/{ticket-id}-{short-description}`. Never commit to `main` directly; all via PR with one approving review and green CI.

## 7.4 API Design Rules

1. `tenant_id` is never a client-supplied parameter; resolved server-side from the JWT.

```java
public record OrderCreateRequestDto(UUID tenantId, OrderType type) {} // WRONG: never accept tenantId
```

2. `Idempotency-Key` (UUID) required on: order create/close, payment post, JE post, PO approval, payroll run, till close, stock-count post, vendor payment. Stored 24h; same key returns the original response; same key + different body → 409 `IDEMPOTENCY_KEY_CONFLICT`.

```java
@PostMapping("/orders/{id}/close")
public ApiResponse<OrderResponseDto> close(@PathVariable UUID id,
        @RequestHeader("Idempotency-Key") UUID idempotencyKey,
        @Valid @RequestBody OrderCloseRequestDto body) {
    return ApiResponse.ok(orderService.close(id, idempotencyKey, body));
}
```

3. Editable resources carry a `version` integer; updates use `If-Match`; mismatch → 409 `CONFLICT`.

4. Standard response envelope always used: success `ApiResponse<T>`; errors `ApiError`. Never return a bare object or raw string.

5. Error codes only from the catalogue (HTTP status in parentheses): `BAD_REQUEST` (400), `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `INVALID_CREDENTIALS` (401, login only), `ACCOUNT_LOCKED` (401, login only), `TOTP_REQUIRED` (401), `PERMISSION_DENIED` (403), `FEATURE_DISABLED` (403), `TENANT_SUSPENDED` (403), `NOT_FOUND` (404), `STATE_INVALID` (409), `CONFLICT` (409), `IDEMPOTENCY_KEY_CONFLICT` (409), `QUOTA_EXCEEDED` (429), `RATE_LIMITED` (429), `PERIOD_LOCKED` (423), `INTERNAL_ERROR` (500), `UPSTREAM_FAILURE` (502). Inventing a new code is forbidden. Note: `INVALID_CREDENTIALS` and `ACCOUNT_LOCKED` are auth-flow additions to the spec's Appendix A.3 catalogue; `PERIOD_LOCKED` (423) is likewise an addition used by Finance. These three are intentional and normative.
