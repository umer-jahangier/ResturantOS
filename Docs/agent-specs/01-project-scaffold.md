# RestaurantOS — Document 1: Project Scaffold & Folder Structure

> This document defines the monorepo structure, Maven multi-module setup, per-service Java and Next.js folder structures, and file/package naming conventions. AI agents must place files exactly as specified so the codebase stays consistent.

## 1.1 Repository Root Layout (Monorepo)

```
restaurantos/
├── pom.xml                      # Maven parent (restaurantos-parent)
├── shared-lib/                  # shared Java library (imported by every service)
├── services/
│   ├── platform-admin-service/
│   ├── auth-service/
│   ├── user-service/
│   ├── authorization-service/
│   ├── pos-service/
│   ├── inventory-service/
│   ├── finance-service/
│   ├── purchasing-service/
│   ├── hr-service/
│   ├── crm-service/
│   ├── kitchen-service/
│   ├── notification-service/
│   ├── reporting-service/
│   ├── audit-service/
│   └── file-service/
├── nlq-service/                 # Python (FastAPI) NLQ service
├── gateway/                     # Spring Cloud Gateway
├── config-server/               # Spring Cloud Config
├── eureka-server/               # Service discovery
├── frontend/                    # Next.js 14 (App Router)
├── policies/                    # OPA Rego policies
├── deploy/                      # docker-compose, init scripts, helm
└── docs/                        # specifications and agent docs
```

## 1.2 Maven Parent `pom.xml`

The parent POM centralizes dependency versions through `dependencyManagement`. Child modules never pin versions.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>io.restaurantos</groupId>
    <artifactId>restaurantos-parent</artifactId>
    <version>1.0.0</version>
    <packaging>pom</packaging>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.5</version>
        <relativePath/>
    </parent>

    <properties>
        <java.version>21</java.version>
        <spring-cloud.version>2023.0.3</spring-cloud.version>
        <mapstruct.version>1.6.2</mapstruct.version>
        <jjwt.version>0.12.6</jjwt.version>
        <testcontainers.version>1.20.3</testcontainers.version>
    </properties>

    <modules>
        <module>shared-lib</module>
        <module>services/platform-admin-service</module>
        <module>services/auth-service</module>
        <module>services/user-service</module>
        <module>services/authorization-service</module>
        <module>services/pos-service</module>
        <module>services/inventory-service</module>
        <module>services/finance-service</module>
        <module>services/purchasing-service</module>
        <module>services/hr-service</module>
        <module>services/crm-service</module>
        <module>services/kitchen-service</module>
        <module>services/notification-service</module>
        <module>services/reporting-service</module>
        <module>services/audit-service</module>
        <module>services/file-service</module>
        <module>gateway</module>
        <module>config-server</module>
        <module>eureka-server</module>
    </modules>

    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.springframework.cloud</groupId>
                <artifactId>spring-cloud-dependencies</artifactId>
                <version>${spring-cloud.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
            <dependency>
                <groupId>io.restaurantos</groupId>
                <artifactId>shared-lib</artifactId>
                <version>1.0.0</version>
            </dependency>
        </dependencies>
    </dependencyManagement>
</project>
```

Child module references `shared-lib` without a version (inherited):

```xml
<dependency>
    <groupId>io.restaurantos</groupId>
    <artifactId>shared-lib</artifactId>
</dependency>
```

Build order: `shared-lib` builds first (it is a dependency of all services); Maven resolves the reactor order automatically from the `<modules>` graph.

## 1.3 Canonical Service Folder Structure (`pos-service`)

```
pos-service/
├── pom.xml
└── src/
    ├── main/
    │   ├── java/io/restaurantos/pos/
    │   │   ├── PosServiceApplication.java
    │   │   ├── controller/
    │   │   ├── service/
    │   │   ├── repository/
    │   │   ├── entity/
    │   │   ├── dto/
    │   │   │   ├── request/
    │   │   │   └── response/
    │   │   ├── event/
    │   │   │   ├── publisher/
    │   │   │   └── listener/
    │   │   ├── mapper/
    │   │   ├── config/
    │   │   ├── exception/
    │   │   └── client/
    │   └── resources/
    │       ├── application.yml
    │       └── db/changelog/
    │           ├── db.changelog-master.xml
    │           └── changes/
    └── test/
        └── java/io/restaurantos/pos/
```

Per-service difference from this canonical layout: services without outbound events omit `event/publisher`; services with no inter-service calls omit `client/`. `reporting-service` adds `clickhouse/`; `nlq-service` follows a Python FastAPI layout instead.

## 1.4 `shared-lib` Folder Structure

```
shared-lib/src/main/java/io/restaurantos/shared/
├── entity/        # TenantAuditableEntity
├── tenant/        # TenantContext, interceptors, propagation
├── security/      # JWT filter, security config, encryption
├── feature/       # @RequiresFeature, FeatureFlagAspect
├── authz/         # OpaClient, AuthorizationService
├── idempotency/   # IdempotencyService
├── event/         # EventPublisher, EventEnvelope, outbox
├── api/           # ApiResponse, ApiError, GlobalExceptionHandler
├── exception/     # RestaurantOsException hierarchy
├── money/         # Money, MoneyUtils
└── config/        # SharedAutoConfiguration, AuditorAware, Feign config
```

## 1.5 Frontend `src/` Directory Tree (Next.js 14 App Router)

```
frontend/src/
├── app/                       # routes (App Router)
├── lib/
│   ├── api-client/            # axios instance (interceptors, auth)
│   ├── repositories/          # one per resource; calls api-client
│   ├── adapters/              # API DTO -> domain model (paisa -> Money)
│   ├── models/                # domain models + Zod schemas
│   ├── hooks/                 # TanStack Query hooks
│   └── stores/                # Zustand stores
├── components/
│   ├── ui/                    # shadcn/ui primitives
│   └── shared/
└── __mocks__/                 # MSW handlers
```

## 1.6 File Naming Conventions

| Artifact | Convention | Example |
|---|---|---|
| Java class | PascalCase + role suffix | `OrderServiceImpl.java` |
| Java entity | `{Domain}Entity` | `OrderEntity.java` |
| TS component | PascalCase | `OrderDetail.tsx` |
| TS hook | `use-kebab-case` | `use-close-order.ts` |
| TS repository | `kebab-case.repository.ts` | `order.repository.ts` |
| Liquibase changeset | `NNN-verb-noun.xml` | `001-create-orders-table.xml` |
| RabbitMQ routing key | `dot.case` | `pos.order.closed` |
| Helm value file | `values-{env}.yaml` | `values-prod.yaml` |
| OPA policy | `kebab-or-module.rego` | `pos.rego` |

## 1.7 Package Naming Rules

Base package is `io.restaurantos.{service-name}`. Valid service-name tokens: `platform`, `auth`, `user`, `authz`, `pos`, `inventory`, `finance`, `purchasing`, `hr`, `crm`, `kitchen`, `notification`, `reporting`, `audit`, `file`, `shared`, `gateway`, `configserver`, `eureka`. Entities go in `.entity`, repositories in `.repository`, services in `.service`, controllers in `.controller`, DTOs in `.dto.request` / `.dto.response`.
