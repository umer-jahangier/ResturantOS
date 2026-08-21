#!/usr/bin/env bash
# Emits deploy/k8s/base/*.yaml. Run from repo root:  bash deploy/k8s/generate.sh
#
# WHY A GENERATOR RATHER THAN 25 HAND-WRITTEN FILES:
# the 15 business services differ only in name, port, and how they spell their
# database variables — and that spelling is genuinely inconsistent in the app
# (auth/authorization use DB_HOST+DB_NAME; the rest use <PREFIX>_DB_URL; audit
# additionally needs a separate admin identity for its Liquibase migrations).
# The table below records every one of those differences in one diffable place,
# instead of scattering them over 15 near-identical files where a typo in one is
# invisible. Infrastructure is written out literally, because each store really
# is different and a parameterised template would obscure that.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/deploy/k8s/base"
rm -rf "$OUT"; mkdir -p "$OUT"

# ── name | port | db-style | db-name | db-user ───────────────────────────────
#   classic => DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
#   <STYLE> => <STYLE>_DB_URL / <STYLE>_DB_USER / <STYLE>_DB_PASSWORD
SERVICES='auth-service|8081|classic|auth_db|auth_user
user-service|8082|USER|user_db|user_service
authorization-service|8083|classic|auth_db|auth_user
pos-service|8084|POS|pos_db|pos_user
inventory-service|8085|INVENTORY|inventory_db|inventory_user
finance-service|8086|FINANCE|finance_db|finance_user
purchasing-service|8087|PURCHASING|purchasing_db|purchasing_user
hr-service|8088|HR|hr_db|hr_user
crm-service|8089|CRM|crm_db|crm_user
kitchen-service|8090|KITCHEN|kitchen_db|kitchen_user
reporting-service|8092|REPORTING|reporting_db|reporting_user
audit-service|8093|AUDIT|audit_db|audit_writer
nlq-service|8094|NLQ|nlq_db|nlq_user
file-service|8095|FILE|file_db|file_service
platform-admin-service|8096|PLATFORM|platform_db|platform_user'

# ═══ 00  shared non-secret config ════════════════════════════════════════════
# EUREKA_URL *and* EUREKA_URI are both set deliberately: the fleet disagrees
# about the spelling (audit/auth/authorization/crm/file/hr/user read _URL;
# finance/inventory/kitchen/nlq/platform/pos/purchasing/reporting read _URI) and
# the two defaults differ even in the trailing slash. Setting only one would
# leave half the fleet quietly pointing at localhost and failing to register.
cat > "$OUT/00-config.yaml" <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: restaurantos-config
data:
  EUREKA_URL: "http://eureka-server:8761/eureka/"
  EUREKA_URI: "http://eureka-server:8761/eureka"
  CONFIG_URI: "http://config-server:8888"
  JWKS_URI: "http://auth-service:8081/.well-known/jwks.json"
  # authorization-service reads ${JWT_JWKS_URL} with NO fallback, so an unset
  # value is not a bad default — it is a PlaceholderResolutionException and the
  # context never starts. Same URL, third spelling.
  JWT_JWKS_URL: "http://auth-service:8081/.well-known/jwks.json"
  REDIS_HOST: "redis"
  REDIS_PORT: "6379"
  RABBITMQ_HOST: "rabbitmq"
  RABBITMQ_PORT: "5672"
  RABBITMQ_VHOST: "/"
  OPA_URL: "http://opa:8181"
  MINIO_ENDPOINT: "http://minio:9000"
  MINIO_BUCKET: "restaurantos-files"
  CLICKHOUSE_URL: "http://clickhouse:8123"
  CLICKHOUSE_DB: "clickhouse_analytics"
  AUTH_SERVICE_URI: "http://auth-service:8081"
  USER_SERVICE_URI: "http://user-service:8082"
  POS_SERVICE_URI: "http://pos-service:8084"
  FINANCE_SERVICE_URI: "http://finance-service:8086"
  PLATFORM_ADMIN_URI: "http://platform-admin-service:8096"
  PLATFORM_ADMIN_SERVICE_URI: "http://platform-admin-service:8096"
  SPRING_PROFILES_ACTIVE: "native"
  AUTH_COOKIE_SECURE: "true"
  # Fifteen services x HikariCP's default pool of 10 = 150 connections against a
  # Postgres whose default max_connections is 100. Measured: audit, pos and
  # reporting all died with "remaining connection slots are reserved for roles
  # with the SUPERUSER attribute" — Postgres holds back
  # superuser_reserved_connections so an admin can still get in once the pool is
  # exhausted, which is why the message blames SUPERUSER rather than saying the
  # server is full. Each backend is a PROCESS with its own memory, so the right
  # fix is to stop asking for connections nobody uses, not only to raise the cap.
  SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE: "5"
  SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE: "1"
EOF

# ═══ 10  postgres ════════════════════════════════════════════════════════════
# The init SQL uses psql backticks — \set auth_pw `echo "$AUTH_DB_PASSWORD"` —
# so every *_DB_PASSWORD must be in THIS container's environment, not just the
# services'. envFrom the same Secret does that. Note the init scripts only ever
# run when the data directory is empty; on an existing PVC they are skipped.
cat > "$OUT/10-postgres.yaml" <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: postgres-data }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 20Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: postgres }
spec:
  selector: { app: postgres }
  ports: [{ name: pg, port: 5432, targetPort: 5432 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: postgres }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: postgres } }
  template:
    metadata: { labels: { app: postgres, tier: infra } }
    spec:
      containers:
        - name: postgres
          image: postgres:18.4
          # 200, not the default 100. The pool cap above brings steady-state
          # demand to ~75 per namespace, but services with a SECOND datasource
          # (audit-service migrates as audit_user and writes as audit_writer)
          # bind it under a custom property name that
          # SPRING_DATASOURCE_HIKARI_* does not reach, so headroom still matters.
          args: ["postgres", "-c", "max_connections=200", "-c", "shared_buffers=256MB"]
          # A SEPARATE secret, not restaurantos-secrets. The init SQL needs every
          # *_DB_PASSWORD in this container's environment, but envFrom-ing the
          # application secret would also hand the database container the JWT
          # signing key, the field-encryption key and the internal service
          # secret — none of which Postgres has any use for.
          envFrom:
            - secretRef: { name: restaurantos-db-passwords }
          env:
            - { name: POSTGRES_USER,  valueFrom: { secretKeyRef: { name: restaurantos-db-passwords, key: POSTGRES_SUPERUSER } } }
            - { name: POSTGRES_PASSWORD, valueFrom: { secretKeyRef: { name: restaurantos-db-passwords, key: POSTGRES_SUPERUSER_PASSWORD } } }
            - { name: POSTGRES_DB, value: "postgres" }
            - { name: PGDATA, value: "/var/lib/postgresql/data/pgdata" }
          ports: [{ containerPort: 5432 }]
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data }
            - { name: init, mountPath: /docker-entrypoint-initdb.d }
          resources:
            requests: { memory: "512Mi", cpu: "100m" }
            limits:   { memory: "2Gi" }
          readinessProbe:
            exec: { command: ["sh","-c","pg_isready -U $POSTGRES_USER"] }
            initialDelaySeconds: 10
            periodSeconds: 10
      volumes:
        - { name: data, persistentVolumeClaim: { claimName: postgres-data } }
        - { name: init, configMap: { name: postgres-init } }
EOF

# ═══ 11  redis ═══════════════════════════════════════════════════════════════
cat > "$OUT/11-redis.yaml" <<'EOF'
apiVersion: v1
kind: Service
metadata: { name: redis }
spec:
  selector: { app: redis }
  ports: [{ name: redis, port: 6379, targetPort: 6379 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: redis }
spec:
  replicas: 1
  selector: { matchLabels: { app: redis } }
  template:
    metadata: { labels: { app: redis, tier: infra } }
    spec:
      containers:
        - name: redis
          image: redis:8.2
          command: ["sh","-c","exec redis-server --requirepass \"$REDIS_PASSWORD\" --appendonly no --save ''"]
          env:
            - { name: REDIS_PASSWORD, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: REDIS_PASSWORD } } }
          ports: [{ containerPort: 6379 }]
          resources:
            requests: { memory: "64Mi", cpu: "25m" }
            limits:   { memory: "256Mi" }
          readinessProbe:
            exec: { command: ["sh","-c","redis-cli -a \"$REDIS_PASSWORD\" ping | grep -q PONG"] }
            initialDelaySeconds: 5
            periodSeconds: 10
EOF

# ═══ 12  rabbitmq ════════════════════════════════════════════════════════════
# No load_definitions here, unlike docker-compose: that file is rendered from a
# template carrying a password hash, and every service already declares the
# exchanges, queues and bindings it owns as idempotent @Beans (see
# deploy/init/README-topology.md). Declaring them twice buys nothing.
cat > "$OUT/12-rabbitmq.yaml" <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: rabbitmq-data }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 5Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: rabbitmq }
spec:
  selector: { app: rabbitmq }
  ports:
    - { name: amqp, port: 5672, targetPort: 5672 }
    - { name: mgmt, port: 15672, targetPort: 15672 }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: rabbitmq }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: rabbitmq } }
  template:
    metadata: { labels: { app: rabbitmq, tier: infra } }
    spec:
      containers:
        - name: rabbitmq
          image: rabbitmq:4.3-management
          env:
            - { name: RABBITMQ_DEFAULT_USER, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: RABBITMQ_USERNAME } } }
            - { name: RABBITMQ_DEFAULT_PASS, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: RABBITMQ_PASSWORD } } }
          ports: [{ containerPort: 5672 }, { containerPort: 15672 }]
          volumeMounts: [{ name: data, mountPath: /var/lib/rabbitmq }]
          resources:
            requests: { memory: "256Mi", cpu: "50m" }
            limits:   { memory: "768Mi" }
          readinessProbe:
            exec: { command: ["rabbitmq-diagnostics","-q","ping"] }
            initialDelaySeconds: 20
            periodSeconds: 15
            timeoutSeconds: 10
      volumes:
        - { name: data, persistentVolumeClaim: { claimName: rabbitmq-data } }
EOF

# ═══ 13  minio ═══════════════════════════════════════════════════════════════
cat > "$OUT/13-minio.yaml" <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: minio-data }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 10Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: minio }
spec:
  selector: { app: minio }
  ports:
    - { name: api, port: 9000, targetPort: 9000 }
    - { name: console, port: 9001, targetPort: 9001 }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: minio }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: minio } }
  template:
    metadata: { labels: { app: minio, tier: infra } }
    spec:
      containers:
        - name: minio
          image: minio/minio:RELEASE.2024-09-13T20-26-02Z
          args: ["server","/data","--console-address",":9001"]
          env:
            - { name: MINIO_ROOT_USER, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: MINIO_ACCESS_KEY } } }
            - { name: MINIO_ROOT_PASSWORD, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: MINIO_SECRET_KEY } } }
          ports: [{ containerPort: 9000 }, { containerPort: 9001 }]
          volumeMounts: [{ name: data, mountPath: /data }]
          resources:
            requests: { memory: "128Mi", cpu: "25m" }
            limits:   { memory: "512Mi" }
          readinessProbe:
            httpGet: { path: /minio/health/ready, port: 9000 }
            initialDelaySeconds: 10
            periodSeconds: 10
      volumes:
        - { name: data, persistentVolumeClaim: { claimName: minio-data } }
EOF

# ═══ 14  clickhouse ══════════════════════════════════════════════════════════
cat > "$OUT/14-clickhouse.yaml" <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: clickhouse-data }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 10Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: clickhouse }
spec:
  selector: { app: clickhouse }
  ports:
    - { name: http, port: 8123, targetPort: 8123 }
    - { name: native, port: 9000, targetPort: 9000 }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: clickhouse }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: clickhouse } }
  template:
    metadata: { labels: { app: clickhouse, tier: infra } }
    spec:
      containers:
        - name: clickhouse
          image: clickhouse/clickhouse-server:25.9
          env:
            - { name: CLICKHOUSE_USER, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: CLICKHOUSE_USER } } }
            - { name: CLICKHOUSE_PASSWORD, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: CLICKHOUSE_PASSWORD } } }
            - { name: CLICKHOUSE_DB, value: "clickhouse_analytics" }
            - { name: CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT, value: "1" }
          ports: [{ containerPort: 8123 }, { containerPort: 9000 }]
          volumeMounts:
            - { name: data, mountPath: /var/lib/clickhouse }
            - { name: tuning, mountPath: /etc/clickhouse-server/config.d/log-limits.xml, subPath: log-limits.xml }
          resources:
            requests: { memory: "512Mi", cpu: "100m" }
            limits:   { memory: "2Gi" }
          readinessProbe:
            httpGet: { path: /ping, port: 8123 }
            initialDelaySeconds: 20
            periodSeconds: 15
      volumes:
        - { name: data, persistentVolumeClaim: { claimName: clickhouse-data } }
        - { name: tuning, configMap: { name: clickhouse-tuning } }
EOF

# ═══ 15  opa ═════════════════════════════════════════════════════════════════
# The OPA image is static — no shell, no wget — so the probe must be httpGet,
# performed by the kubelet. DefaultOpaClient is fail-closed, so an OPA that is
# up-but-policyless refuses everything: the policies ConfigMap is therefore part
# of the same apply, never a follow-up step.
cat > "$OUT/15-opa.yaml" <<'EOF'
apiVersion: v1
kind: Service
metadata: { name: opa }
spec:
  selector: { app: opa }
  ports: [{ name: http, port: 8181, targetPort: 8181 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: opa }
spec:
  replicas: 1
  selector: { matchLabels: { app: opa } }
  template:
    metadata: { labels: { app: opa, tier: infra } }
    spec:
      containers:
        - name: opa
          image: openpolicyagent/opa:1.17.1
          # --ignore=.* is REQUIRED, not tidiness. A ConfigMap volume is projected
          # through two symlink layers so updates are atomic:
          #     /policies/pos.rego -> ..data/pos.rego -> ..2026_08_21_.../pos.rego
          # OPA loads /policies recursively, so without --ignore it reads every
          # policy THREE times and dies with "multiple default rules
          # data.restaurantos.pos.allow found". Measured on this cluster: 7 of 8
          # policies failed exactly that way. Using subPath mounts instead would
          # also silence it, but subPath does not receive ConfigMap updates — OPA
          # would then enforce its boot-time policies forever while the repo said
          # otherwise, which for a fail-closed engine is the more dangerous bug.
          args: ["run","--server","--addr=0.0.0.0:8181","--log-level=info","--ignore=.*","/policies"]
          ports: [{ containerPort: 8181 }]
          volumeMounts: [{ name: policies, mountPath: /policies, readOnly: true }]
          resources:
            requests: { memory: "64Mi", cpu: "25m" }
            limits:   { memory: "256Mi" }
          readinessProbe:
            httpGet: { path: /health, port: 8181 }
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - { name: policies, configMap: { name: opa-policies } }
EOF
echo "  infra: postgres redis rabbitmq minio clickhouse opa"

# ═══ JVM workload emitter ════════════════════════════════════════════════════
# PROBE DESIGN, which is the part most worth reading:
#   startup  — httpGet /actuator/health, 5s x 60 = five minutes. A cold Spring
#              Boot JVM with Liquibase/Flyway on a contended 8-vCPU box takes far
#              longer than the 30s a default probe allows; without this the pod
#              is killed mid-migration and CrashLoopBackOffs forever.
#   readiness— httpGet /actuator/health. Includes the DB, which is correct: a
#              service that cannot reach Postgres must leave the Service's
#              endpoint list rather than take traffic it will fail.
#   liveness — tcpSocket, NOT httpGet /actuator/health. This is deliberate. A
#              health endpoint that aggregates the database will report DOWN
#              during any Postgres blip; wiring that to liveness restarts every
#              service in the namespace at once and turns a 10-second database
#              hiccup into a full cold start of the fleet. TCP restarts only a
#              JVM that is genuinely wedged.
# INIT_WAIT gates a pod on its dependencies. Without it, sixteen JVMs start
# racing Postgres and Eureka, every one fails its Liquibase/Flyway run, and they
# CrashLoopBackOff their way to health over ~10 minutes with a 5-minute maximum
# backoff. That "recovers", but it makes `kubectl rollout status` meaningless as
# a deploy gate — which is the whole signal CI depends on.
INIT_WAIT=""
emit_jvm() { # $1 name  $2 port  $3 extra-env-yaml  $4 mem-request  $5 mem-limit
  local name="$1" port="$2" extra="$3" req="$4" lim="$5"
  cat > "$OUT/$6-$name.yaml" <<EOF
apiVersion: v1
kind: Service
metadata:
  name: $name
  labels: { app: $name }
spec:
  selector: { app: $name }
  ports: [{ name: http, port: $port, targetPort: $port }]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $name
  labels: { app: $name }
spec:
  replicas: 1
  selector: { matchLabels: { app: $name } }
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  template:
    metadata:
      labels: { app: $name, tier: app }
    spec:
${INIT_WAIT}      containers:
        - name: $name
          image: restaurantos/$name:latest
          ports: [{ containerPort: $port, name: http }]
          envFrom:
            - configMapRef: { name: restaurantos-config }
            - secretRef:    { name: restaurantos-secrets }
          env:
            - { name: SERVER_PORT, value: "$port" }
$extra
          resources:
            requests: { memory: "$req", cpu: "50m" }
            limits:   { memory: "$lim" }
          startupProbe:
            httpGet: { path: /actuator/health, port: $port }
            periodSeconds: 5
            failureThreshold: 60
          readinessProbe:
            httpGet: { path: /actuator/health, port: $port }
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            tcpSocket: { port: $port }
            periodSeconds: 20
            failureThreshold: 6
EOF
}

# ═══ 20/21  service discovery + config ═══════════════════════════════════════
INIT_WAIT=""   # eureka depends on nothing
emit_jvm eureka-server 8761 '            - { name: EUREKA_CLIENT_REGISTER_WITH_EUREKA, value: "false" }
            - { name: EUREKA_CLIENT_FETCH_REGISTRY, value: "false" }' 200Mi 420Mi 20
INIT_WAIT=""   # config-server serves files from a ConfigMap; no backing services
# config-server runs the `native` profile against a ConfigMap of deploy/config-repo,
# so no external git repo is required to boot the fleet.
emit_jvm config-server 8888 '            - { name: CONFIG_SEARCH_LOCATIONS, value: "file:/config-repo" }' 200Mi 420Mi 21
python3 - "$OUT/21-config-server.yaml" <<'PY'
import sys, io
p = sys.argv[1]; s = io.open(p).read()
s = s.replace("""          startupProbe:""", """          volumeMounts:
            - { name: config-repo, mountPath: /config-repo, readOnly: true }
          startupProbe:""")
s = s.rstrip("\n") + """
      volumes:
        - { name: config-repo, configMap: { name: config-repo } }
"""
io.open(p, "w").write(s)
PY

# ═══ 30  the fifteen business services ═══════════════════════════════════════
INIT_WAIT='      initContainers:
        - name: wait-for-deps
          image: busybox:1.36
          command: ["sh","-c","until nc -z postgres 5432 && nc -z eureka-server 8761; do echo waiting for postgres+eureka; sleep 3; done"]
          resources: { requests: { memory: "8Mi", cpu: "10m" }, limits: { memory: "32Mi" } }
'
while IFS='|' read -r name port style db dbuser; do
  [ -z "$name" ] && continue
  # Both "classic" services (auth-service, authorization-service) share auth_db
  # and the auth_user role, so AUTH_DB_PASSWORD is right for both. If a third
  # classic service ever appears on a different database, this needs a column.
  if [ "$style" = "classic" ]; then
    extra="            - { name: DB_HOST, value: \"postgres\" }
            - { name: DB_PORT, value: \"5432\" }
            - { name: DB_NAME, value: \"$db\" }
            - { name: DB_USER, value: \"$dbuser\" }
            - { name: DB_PASSWORD, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: AUTH_DB_PASSWORD } } }"
  else
    extra="            - { name: ${style}_DB_URL, value: \"jdbc:postgresql://postgres:5432/$db\" }
            - { name: ${style}_DB_USER, value: \"$dbuser\" }
            - { name: ${style}_DB_PASSWORD, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: ${style}_DB_PASSWORD } } }"
  fi
  # audit-service migrates with a DIFFERENT identity than it writes with:
  # audit_user owns the schema (GRANT ALL + CREATE), audit_writer is INSERT-only.
  # Both are created with the same password by init/02-create-roles.sql.
  if [ "$name" = "audit-service" ]; then
    extra="$extra
            - { name: AUDIT_DB_ADMIN_URL, value: \"jdbc:postgresql://postgres:5432/audit_db\" }
            - { name: AUDIT_DB_ADMIN_USER, value: \"audit_user\" }
            - { name: AUDIT_DB_ADMIN_PASSWORD, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: AUDIT_DB_PASSWORD } } }"
  fi
  emit_jvm "$name" "$port" "$extra" 300Mi 640Mi 30
done <<< "$SERVICES"

# ═══ 40  gateway ═════════════════════════════════════════════════════════════
INIT_WAIT='      initContainers:
        - name: wait-for-deps
          image: busybox:1.36
          command: ["sh","-c","until nc -z eureka-server 8761 && nc -z redis 6379; do echo waiting for eureka+redis; sleep 3; done"]
          resources: { requests: { memory: "8Mi", cpu: "10m" }, limits: { memory: "32Mi" } }
'
emit_jvm gateway 8080 '            - { name: LOG_LEVEL_GATEWAY, value: "INFO" }
            - { name: FAIL_OPEN_ON_PLATFORM_DOWN, value: "false" }' 300Mi 640Mi 40

# ═══ 50  frontend ════════════════════════════════════════════════════════════
cat > "$OUT/50-frontend.yaml" <<'EOF'
apiVersion: v1
kind: Service
metadata: { name: frontend, labels: { app: frontend } }
spec:
  selector: { app: frontend }
  ports: [{ name: http, port: 3000, targetPort: 3000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: frontend, labels: { app: frontend } }
spec:
  replicas: 1
  selector: { matchLabels: { app: frontend } }
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  template:
    metadata: { labels: { app: frontend, tier: app } }
    spec:
      containers:
        - name: frontend
          image: restaurantos/frontend:latest
          ports: [{ containerPort: 3000, name: http }]
          resources:
            requests: { memory: "192Mi", cpu: "50m" }
            limits:   { memory: "512Mi" }
          startupProbe:
            httpGet: { path: /, port: 3000 }
            periodSeconds: 5
            failureThreshold: 36
          readinessProbe:
            httpGet: { path: /, port: 3000 }
            periodSeconds: 10
          livenessProbe:
            tcpSocket: { port: 3000 }
            periodSeconds: 20
            failureThreshold: 6
EOF

echo "  generated $(ls "$OUT" | wc -l | tr -d ' ') manifests in deploy/k8s/base/"

# ═══ 60  one-shot bootstrap Jobs ═════════════════════════════════════════════
# Two things the application cannot create for itself, and which failed loudly
# when they were missing:
#
#  - RabbitMQ topology. Compose pre-provisions it via load_definitions; this
#    deployment does not, because that file also carries a hashed user and
#    RABBITMQ_DEFAULT_USER goes inert once definitions are loaded. audit-service
#    then died on channel.close(404) — it @RabbitListener's a queue it does not
#    itself declare. So the topology is imported over the management API with
#    users/permissions STRIPPED, leaving the generated credentials authoritative.
#
#  - ClickHouse fact tables. reporting-service fails startup with
#    "expected 4 ClickHouse fact tables" — it verifies rather than assumes, which
#    is right, but it means the migrations must have run first.
#
# Both are Jobs, and a Job's spec is IMMUTABLE — re-applying an existing one is
# rejected. deploy/k8s/apply.sh deletes them before applying for that reason.
cat > "$OUT/60-bootstrap-jobs.yaml" <<'EOF'
apiVersion: batch/v1
kind: Job
metadata:
  name: rabbit-topology-import
spec:
  backoffLimit: 30
  ttlSecondsAfterFinished: 3600
  template:
    metadata: { labels: { app: rabbit-topology-import, tier: bootstrap } }
    spec:
      restartPolicy: OnFailure
      containers:
        - name: import
          image: curlimages/curl:8.10.1
          env:
            - { name: RU, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: RABBITMQ_USERNAME } } }
            - { name: RP, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: RABBITMQ_PASSWORD } } }
          command:
            - sh
            - -c
            - |
              until curl -sf -u "$RU:$RP" http://rabbitmq:15672/api/overview >/dev/null 2>&1; do
                echo "waiting for the rabbitmq management api"; sleep 5
              done
              curl -sf -u "$RU:$RP" -H 'content-type: application/json'                    -X POST http://rabbitmq:15672/api/definitions                    --data-binary @/defs/definitions.json
              echo "topology imported"
          volumeMounts: [{ name: defs, mountPath: /defs, readOnly: true }]
          resources: { requests: { memory: "16Mi", cpu: "10m" }, limits: { memory: "64Mi" } }
      volumes:
        - { name: defs, configMap: { name: rabbit-topology } }
---
apiVersion: batch/v1
kind: Job
metadata:
  name: clickhouse-migrate
spec:
  backoffLimit: 30
  ttlSecondsAfterFinished: 3600
  template:
    metadata: { labels: { app: clickhouse-migrate, tier: bootstrap } }
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrate
          image: clickhouse/clickhouse-server:25.9
          env:
            - { name: CU,  valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: CLICKHOUSE_USER } } }
            - { name: CP,  valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: CLICKHOUSE_PASSWORD } } }
            - { name: ROP, valueFrom: { secretKeyRef: { name: restaurantos-secrets, key: CLICKHOUSE_READONLY_PASSWORD } } }
          command:
            - sh
            - -c
            - |
              until clickhouse-client --host clickhouse --user "$CU" --password "$CP"                     --query "SELECT 1" >/dev/null 2>&1; do
                echo "waiting for clickhouse"; sleep 5
              done
              for f in /mig/V0*.sql; do
                echo "applying $(basename "$f")"
                # V002 carries ${CLICKHOUSE_READONLY_PASSWORD}; apply.sh does this with
                # envsubst, which this image does not ship. sed is equivalent here and
                # keeps the password out of the process list.
                sed "s|\${CLICKHOUSE_READONLY_PASSWORD}|$ROP|g" "$f" > /tmp/m.sql
                clickhouse-client --host clickhouse --user "$CU" --password "$CP"                   --multiquery < /tmp/m.sql || exit 1
              done
              echo "clickhouse migrations applied"
          volumeMounts: [{ name: mig, mountPath: /mig, readOnly: true }]
          resources: { requests: { memory: "64Mi", cpu: "25m" }, limits: { memory: "512Mi" } }
      volumes:
        - { name: mig, configMap: { name: clickhouse-migrations } }
EOF

# ═══ ConfigMap source files ══════════════════════════════════════════════════
# Copied in rather than referenced with ../../ because kustomize refuses to read
# files above the kustomization root unless you pass --load-restrictor
# LoadRestrictionsNone, which `kubectl apply -k` does not expose. These copies
# are build output: edit the originals under deploy/init and deploy/config-repo,
# then re-run this generator.
mkdir -p "$OUT/files"
cp "$ROOT/deploy/init/01-create-databases.sql"        "$OUT/files/"
cp "$ROOT/deploy/init/02-create-roles.sql"            "$OUT/files/"
cp "$ROOT/deploy/init/03-grant-schema-privileges.sql" "$OUT/files/"
cp "$ROOT/deploy/init/clickhouse-log-limits.xml"      "$OUT/files/log-limits.xml"
cp "$ROOT/deploy/config-repo/application.yml"         "$OUT/files/application.yml"
cp "$ROOT"/deploy/clickhouse/V0*.sql                    "$OUT/files/" 2>/dev/null || true
# Topology-only definitions, DERIVED here rather than committed by hand: this
# whole directory is rm -rf'd at the top of this script, so anything dropped in
# by hand disappears on the next run and kustomize then fails on a missing file.
# users/permissions are stripped so RABBITMQ_DEFAULT_USER stays authoritative —
# the shipped definitions file carries a hashed user, and load_definitions makes
# the env-var credentials inert.
python3 - "$ROOT/deploy/init/rabbitmq-definitions.json" "$OUT/files/rabbitmq-topology.json" <<'PYEOF'
import json, io, sys
d = json.load(io.open(sys.argv[1]))
for k in ("users", "permissions", "topic_permissions"):
    d.pop(k, None)
io.open(sys.argv[2], "w").write(json.dumps(d, indent=1))
print("  rabbit topology: %d exchanges, %d queues, %d bindings (credentials stripped)"
      % (len(d["exchanges"]), len(d["queues"]), len(d["bindings"])))
PYEOF
mkdir -p "$OUT/files/policies"
cp "$ROOT"/policies/restaurantos/*.rego               "$OUT/files/policies/"

# ═══ base kustomization ══════════════════════════════════════════════════════
{
  echo "apiVersion: kustomize.config.k8s.io/v1beta1"
  echo "kind: Kustomization"
  echo "resources:"
  # grep -v kustomization.yaml: on a re-run the previous kustomization.yaml is
  # still on disk when this glob runs, and it would list itself as a resource.
  for f in $(ls "$OUT" | grep '\.yaml$' | grep -v '^kustomization\.yaml$' | sort); do echo "  - $f"; done
  cat <<'EOF'
configMapGenerator:
  - name: postgres-init
    files:
      - files/01-create-databases.sql
      - files/02-create-roles.sql
      - files/03-grant-schema-privileges.sql
  - name: clickhouse-tuning
    files:
      - log-limits.xml=files/log-limits.xml
  - name: config-repo
    files:
      - application.yml=files/application.yml
  - name: rabbit-topology
    files:
      - definitions.json=files/rabbitmq-topology.json
  - name: clickhouse-migrations
    files:
EOF
  for f in "$OUT"/files/V0*.sql; do echo "      - $(basename "$f")=files/$(basename "$f")"; done
  cat <<'EOF'
  - name: opa-policies
    files:
EOF
  for f in "$OUT"/files/policies/*.rego; do echo "      - $(basename "$f")=files/policies/$(basename "$f")"; done
  cat <<'EOF'
# Name-suffix hashes are KEPT ON PURPOSE. A policy or init-script edit produces a
# new ConfigMap name, kustomize rewrites the reference, and the pod rolls. With
# disableNameSuffixHash the ConfigMap would change under a running pod and
# nothing would restart — OPA would keep enforcing the previous policy set while
# the repo said otherwise.
EOF
} > "$OUT/kustomization.yaml"
echo "  wrote base/kustomization.yaml"
