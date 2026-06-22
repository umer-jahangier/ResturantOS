# RestaurantOS — Document 6: Dev Docker Compose

> The complete, runnable local development environment. From the repository root, `cd deploy && docker compose up -d` brings up every infrastructure dependency. The Java microservices and the Next.js frontend are NOT in this file — developers run those from their IDE pointing at this infrastructure. All image tags are pinned.

## 6.1 Complete `docker-compose.yml`

File location: `deploy/docker-compose.yml`.

```yaml
name: restaurantos-dev

networks:
  restaurantos:
    name: restaurantos
    driver: bridge

services:
  postgres:
    image: postgres:16.4
    container_name: restaurantos-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_SUPERUSER}
      POSTGRES_PASSWORD: ${POSTGRES_SUPERUSER_PASSWORD}
      POSTGRES_DB: postgres
      AUTH_DB_PASSWORD: ${AUTH_DB_PASSWORD}
      USER_DB_PASSWORD: ${USER_DB_PASSWORD}
      POS_DB_PASSWORD: ${POS_DB_PASSWORD}
      INVENTORY_DB_PASSWORD: ${INVENTORY_DB_PASSWORD}
      FINANCE_DB_PASSWORD: ${FINANCE_DB_PASSWORD}
      PURCHASING_DB_PASSWORD: ${PURCHASING_DB_PASSWORD}
      HR_DB_PASSWORD: ${HR_DB_PASSWORD}
      CRM_DB_PASSWORD: ${CRM_DB_PASSWORD}
      KITCHEN_DB_PASSWORD: ${KITCHEN_DB_PASSWORD}
      NOTIFICATION_DB_PASSWORD: ${NOTIFICATION_DB_PASSWORD}
      AUDIT_DB_PASSWORD: ${AUDIT_DB_PASSWORD}
      FILE_DB_PASSWORD: ${FILE_DB_PASSWORD}
      PLATFORM_DB_PASSWORD: ${PLATFORM_DB_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./init/01-create-databases.sql:/docker-entrypoint-initdb.d/01-create-databases.sql:ro
      - ./init/02-create-roles.sql:/docker-entrypoint-initdb.d/02-create-roles.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_SUPERUSER} -d postgres"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks: [restaurantos]

  redis:
    image: redis:7.4
    container_name: restaurantos-redis
    restart: unless-stopped
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}", "--save", "900", "1"]
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks: [restaurantos]

  rabbitmq:
    image: rabbitmq:3.13-management
    container_name: restaurantos-rabbitmq
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USERNAME}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD}
      RABBITMQ_DEFINITIONS_FILE: /etc/rabbitmq/definitions.json
    ports:
      - "5672:5672"
      - "15672:15672"
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
      - ./init/rabbitmq-definitions.json:/etc/rabbitmq/definitions.json:ro
      - ./init/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 15s
      timeout: 10s
      retries: 10
    networks: [restaurantos]

  minio:
    image: minio/minio:RELEASE.2024-09-13T20-26-02Z
    container_name: restaurantos-minio
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 15s
      timeout: 10s
      retries: 10
    networks: [restaurantos]

  opa:
    image: openpolicyagent/opa:0.65.0
    container_name: restaurantos-opa
    restart: unless-stopped
    command:
      - "run"
      - "--server"
      - "--addr=0.0.0.0:8181"
      - "--log-level=info"
      - "/policies"
    ports:
      - "8181:8181"
    volumes:
      - ../policies:/policies:ro
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8181/health"]
      interval: 15s
      timeout: 5s
      retries: 10
    networks: [restaurantos]

  eureka:
    image: ghcr.io/restaurantos/eureka-server:1.0.0
    container_name: restaurantos-eureka
    restart: unless-stopped
    environment:
      SERVER_PORT: 8761
    ports:
      - "8761:8761"
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8761/actuator/health"]
      interval: 15s
      timeout: 5s
      retries: 10
    networks: [restaurantos]

  config-server:
    image: ghcr.io/restaurantos/config-server:1.0.0
    container_name: restaurantos-config-server
    restart: unless-stopped
    environment:
      SERVER_PORT: 8888
      CONFIG_GIT_URI: ${CONFIG_GIT_URI:-https://github.com/restaurantos/restaurantos-config.git}
      EUREKA_URL: http://eureka:8761/eureka
    ports:
      - "8888:8888"
    depends_on:
      eureka:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8888/actuator/health"]
      interval: 15s
      timeout: 5s
      retries: 10
    networks: [restaurantos]

  clickhouse:
    image: clickhouse/clickhouse-server:24.8
    container_name: restaurantos-clickhouse
    restart: unless-stopped
    environment:
      CLICKHOUSE_USER: ${CLICKHOUSE_USER}
      CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD}
      CLICKHOUSE_DB: clickhouse_analytics
    ports:
      - "8123:8123"
      - "9009:9000"
    volumes:
      - clickhouse-data:/var/lib/clickhouse
      - ./init/clickhouse-init.sql:/docker-entrypoint-initdb.d/clickhouse-init.sql:ro
    ulimits:
      nofile:
        soft: 262144
        hard: 262144
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8123/ping"]
      interval: 15s
      timeout: 5s
      retries: 10
    networks: [restaurantos]

  mailpit:
    image: axllent/mailpit:v1.20
    container_name: restaurantos-mailpit
    restart: unless-stopped
    ports:
      - "1025:1025"
      - "8025:8025"
    networks: [restaurantos]

  pgadmin:
    image: dpage/pgadmin4:8.12
    container_name: restaurantos-pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: ${PGADMIN_DEFAULT_EMAIL}
      PGADMIN_DEFAULT_PASSWORD: ${PGADMIN_DEFAULT_PASSWORD}
      PGADMIN_CONFIG_SERVER_MODE: "False"
    ports:
      - "5050:80"
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - pgadmin-data:/var/lib/pgadmin
    networks: [restaurantos]

volumes:
  postgres-data:
  redis-data:
  rabbitmq-data:
  minio-data:
  clickhouse-data:
  pgadmin-data:
```

Note on ports: in dev, the gateway and Platform Admin service both default to `8080`. If both run locally, set `SERVER_PORT=8096` for platform-admin-service in your IDE run config to avoid the clash.

## 6.2 Named Volumes

| Volume | Stores |
|---|---|
| `postgres-data` | All PostgreSQL service databases and WAL |
| `redis-data` | Redis RDB snapshots (quota counters, feature-flag cache, NLQ cache) |
| `rabbitmq-data` | Durable queues, exchange/binding definitions, persisted messages |
| `minio-data` | Object blobs (logos, payslip PDFs, receipt/invoice templates) |
| `clickhouse-data` | ClickHouse MergeTree parts (`sales_facts`, snapshots) |
| `pgadmin-data` | pgAdmin server registrations and preferences |

## 6.3 Database Initialisation Scripts

`deploy/init/01-create-databases.sql`:

```sql
CREATE DATABASE platform_db;
CREATE DATABASE auth_db;        -- shared by Auth + Authorization services
CREATE DATABASE user_db;
CREATE DATABASE pos_db;
CREATE DATABASE inventory_db;
CREATE DATABASE finance_db;
CREATE DATABASE purchasing_db;
CREATE DATABASE hr_db;
CREATE DATABASE crm_db;
CREATE DATABASE kitchen_db;
CREATE DATABASE notification_db;
CREATE DATABASE audit_db;
CREATE DATABASE file_db;
```

`deploy/init/02-create-roles.sql` — non-superuser role per service, no `BYPASSRLS`:

```sql
\set auth_pw `echo "$AUTH_DB_PASSWORD"`
\set user_pw `echo "$USER_DB_PASSWORD"`
\set pos_pw `echo "$POS_DB_PASSWORD"`
\set inv_pw `echo "$INVENTORY_DB_PASSWORD"`
\set fin_pw `echo "$FINANCE_DB_PASSWORD"`
\set pur_pw `echo "$PURCHASING_DB_PASSWORD"`
\set hr_pw `echo "$HR_DB_PASSWORD"`
\set crm_pw `echo "$CRM_DB_PASSWORD"`
\set kit_pw `echo "$KITCHEN_DB_PASSWORD"`
\set notif_pw `echo "$NOTIFICATION_DB_PASSWORD"`
\set audit_pw `echo "$AUDIT_DB_PASSWORD"`
\set file_pw `echo "$FILE_DB_PASSWORD"`
\set platform_pw `echo "$PLATFORM_DB_PASSWORD"`

CREATE ROLE auth_user        LOGIN PASSWORD :'auth_pw'     NOSUPERUSER NOBYPASSRLS;
CREATE ROLE user_user        LOGIN PASSWORD :'user_pw'     NOSUPERUSER NOBYPASSRLS;
CREATE ROLE pos_user         LOGIN PASSWORD :'pos_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE inventory_user   LOGIN PASSWORD :'inv_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE finance_user     LOGIN PASSWORD :'fin_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE purchasing_user  LOGIN PASSWORD :'pur_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE hr_user          LOGIN PASSWORD :'hr_pw'       NOSUPERUSER NOBYPASSRLS;
CREATE ROLE crm_user         LOGIN PASSWORD :'crm_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE kitchen_user     LOGIN PASSWORD :'kit_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE notification_user LOGIN PASSWORD :'notif_pw'   NOSUPERUSER NOBYPASSRLS;
CREATE ROLE audit_user       LOGIN PASSWORD :'audit_pw'    NOSUPERUSER NOBYPASSRLS;
CREATE ROLE file_user        LOGIN PASSWORD :'file_pw'     NOSUPERUSER NOBYPASSRLS;
CREATE ROLE platform_user    LOGIN PASSWORD :'platform_pw' NOSUPERUSER NOBYPASSRLS;

GRANT ALL PRIVILEGES ON DATABASE auth_db        TO auth_user;
GRANT ALL PRIVILEGES ON DATABASE user_db        TO user_user;
GRANT ALL PRIVILEGES ON DATABASE pos_db         TO pos_user;
GRANT ALL PRIVILEGES ON DATABASE inventory_db   TO inventory_user;
GRANT ALL PRIVILEGES ON DATABASE finance_db     TO finance_user;
GRANT ALL PRIVILEGES ON DATABASE purchasing_db  TO purchasing_user;
GRANT ALL PRIVILEGES ON DATABASE hr_db          TO hr_user;
GRANT ALL PRIVILEGES ON DATABASE crm_db         TO crm_user;
GRANT ALL PRIVILEGES ON DATABASE kitchen_db     TO kitchen_user;
GRANT ALL PRIVILEGES ON DATABASE notification_db TO notification_user;
GRANT ALL PRIVILEGES ON DATABASE audit_db       TO audit_user;
GRANT ALL PRIVILEGES ON DATABASE file_db        TO file_user;
GRANT ALL PRIVILEGES ON DATABASE platform_db    TO platform_user;
-- The authorization-service also connects to auth_db using auth_user.
```

The `audit_user` is further restricted to INSERT-only on `audit_events` by a Liquibase changeset in the audit service (Document 8 §8.6), not here.

## 6.4 RabbitMQ Topology Bootstrap

`deploy/init/rabbitmq.conf`:

```ini
load_definitions = /etc/rabbitmq/definitions.json
```

`deploy/init/rabbitmq-definitions.json` (representative set; extend with the full §2.2 table):

```json
{
  "rabbit_version": "3.13.0",
  "users": [
    { "name": "restaurantos", "password": "your-rabbitmq-password", "tags": ["administrator"] }
  ],
  "vhosts": [{ "name": "/" }],
  "permissions": [
    { "user": "restaurantos", "vhost": "/", "configure": ".*", "write": ".*", "read": ".*" }
  ],
  "exchanges": [
    { "name": "pos.topic", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false },
    { "name": "inventory.topic", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false },
    { "name": "finance.topic", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false },
    { "name": "purchasing.topic", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false },
    { "name": "hr.topic", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false },
    { "name": "auth.topic", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false },
    { "name": "platform.topic", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false },
    { "name": "kitchen.topic", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false },
    { "name": "notifications.topic", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false },
    { "name": "restaurantos.dlx", "vhost": "/", "type": "topic", "durable": true, "auto_delete": false }
  ],
  "queues": [
    { "name": "inventory.order-closed.queue", "vhost": "/", "durable": true, "auto_delete": false,
      "arguments": { "x-dead-letter-exchange": "restaurantos.dlx", "x-dead-letter-routing-key": "inventory.order-closed.queue.dlq" } },
    { "name": "inventory.order-closed.queue.dlq", "vhost": "/", "durable": true, "auto_delete": false, "arguments": {} },
    { "name": "finance.order-closed.queue", "vhost": "/", "durable": true, "auto_delete": false,
      "arguments": { "x-dead-letter-exchange": "restaurantos.dlx", "x-dead-letter-routing-key": "finance.order-closed.queue.dlq" } },
    { "name": "finance.order-closed.queue.dlq", "vhost": "/", "durable": true, "auto_delete": false, "arguments": {} },
    { "name": "audit.all-events.queue", "vhost": "/", "durable": true, "auto_delete": false,
      "arguments": { "x-dead-letter-exchange": "restaurantos.dlx", "x-dead-letter-routing-key": "audit.all-events.queue.dlq" } },
    { "name": "audit.all-events.queue.dlq", "vhost": "/", "durable": true, "auto_delete": false, "arguments": {} }
  ],
  "bindings": [
    { "source": "pos.topic", "vhost": "/", "destination": "inventory.order-closed.queue", "destination_type": "queue", "routing_key": "pos.order.closed", "arguments": {} },
    { "source": "pos.topic", "vhost": "/", "destination": "finance.order-closed.queue", "destination_type": "queue", "routing_key": "pos.order.closed", "arguments": {} },
    { "source": "pos.topic", "vhost": "/", "destination": "audit.all-events.queue", "destination_type": "queue", "routing_key": "#", "arguments": {} },
    { "source": "inventory.topic", "vhost": "/", "destination": "audit.all-events.queue", "destination_type": "queue", "routing_key": "#", "arguments": {} },
    { "source": "finance.topic", "vhost": "/", "destination": "audit.all-events.queue", "destination_type": "queue", "routing_key": "#", "arguments": {} },
    { "source": "restaurantos.dlx", "vhost": "/", "destination": "inventory.order-closed.queue.dlq", "destination_type": "queue", "routing_key": "inventory.order-closed.queue.dlq", "arguments": {} },
    { "source": "restaurantos.dlx", "vhost": "/", "destination": "finance.order-closed.queue.dlq", "destination_type": "queue", "routing_key": "finance.order-closed.queue.dlq", "arguments": {} },
    { "source": "restaurantos.dlx", "vhost": "/", "destination": "audit.all-events.queue.dlq", "destination_type": "queue", "routing_key": "audit.all-events.queue.dlq", "arguments": {} }
  ]
}
```

Per-queue pattern: declare `{queue}` with the two `x-dead-letter-*` args, declare its `.dlq`, bind the queue to its exchange with the routing key, and bind the `.dlq` to `restaurantos.dlx`.

## 6.5 OPA Policy Mount

The OPA container mounts `policies/` read-only at `/policies` and starts with `opa run --server --addr=0.0.0.0:8181 /policies`. Layout:

```
policies/
├── restaurantos/
│   ├── common.rego          # package restaurantos.common
│   ├── pos.rego
│   ├── finance.rego
│   ├── inventory.rego
│   ├── purchasing.rego
│   └── ...
└── tests/
    ├── pos_test.rego
    └── finance_test.rego
```

## 6.6 First-Run Setup Commands

From `deploy/` after copying `.env.example` to `.env`:

1. Start infrastructure:
```bash
docker compose up -d
```

2. Verify health:
```bash
docker compose ps
```

3. Verify PostgreSQL databases:
```bash
docker exec restaurantos-postgres psql -U postgres -c "\l" | grep -E "auth_db|pos_db|finance_db"
```

4. Verify RabbitMQ topology:
```bash
docker exec restaurantos-rabbitmq rabbitmqctl list_exchanges name type | grep "pos.topic"
docker exec restaurantos-rabbitmq rabbitmqctl list_queues name | grep "order-closed"
```

5. Verify ClickHouse:
```bash
curl -s "http://localhost:8123/ping"
curl -s --user "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" "http://localhost:8123/?query=SHOW%20DATABASES" | grep clickhouse_analytics
```

6. Verify OPA loaded policies:
```bash
curl -s "http://localhost:8181/v1/policies" | grep restaurantos
```

7. Create the dev MinIO bucket:
```bash
docker exec restaurantos-minio mc alias set local http://localhost:9000 "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}"
docker exec restaurantos-minio mc mb --ignore-existing local/${MINIO_BUCKET}
```

8. Run the first Liquibase migration (or just start the service from the IDE — Liquibase runs on startup):
```bash
cd ../services/auth-service
mvn -q liquibase:update \
  -Dliquibase.url="jdbc:postgresql://localhost:5432/auth_db" \
  -Dliquibase.username=auth_user \
  -Dliquibase.password="${AUTH_DB_PASSWORD}"
```

## 6.7 `.env.example`

The complete `.env.example` is reproduced in Document 5 §5.2 and lives at `deploy/.env.example`. Copy it to `deploy/.env` before `docker compose up -d`. Every secret has a clearly fake placeholder, never an empty string for required secrets.
