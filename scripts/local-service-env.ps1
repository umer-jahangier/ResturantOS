# Source infra + per-service DB env vars for host-run Spring Boot (Windows).
# Usage: . D:\GitHub\ResturantOS\scripts\local-service-env.ps1

$deployEnv = Join-Path $PSScriptRoot "..\deploy\.env"
if (-not (Test-Path $deployEnv)) {
    Write-Error "deploy/.env missing. Run: bash deploy/generate-keys.sh"
}

Get-Content $deployEnv | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $parts = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
}

# Host-run services reach docker-compose via localhost
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "5432"
$env:REDIS_HOST = "127.0.0.1"
$env:REDIS_PORT = "6379"
$env:RABBITMQ_HOST = "127.0.0.1"
$env:RABBITMQ_PORT = "5672"
$env:RABBITMQ_USER = if ($env:RABBITMQ_USERNAME) { $env:RABBITMQ_USERNAME } else { "restaurantos" }
$env:EUREKA_URL = "http://127.0.0.1:8761/eureka/"
$env:OPA_URL = "http://127.0.0.1:8181"
$env:JWT_JWKS_URL = "http://127.0.0.1:8081/.well-known/jwks.json"
$env:AUTH_SERVICE_URI = "http://127.0.0.1:8081"
$env:AUTH_COOKIE_SECURE = "false"
$env:MINIO_ENDPOINT = "http://127.0.0.1:9000"

# auth-service + authorization-service (auth_db / auth_user)
$env:DB_NAME = "auth_db"
$env:DB_USER = "auth_user"
$env:DB_PASSWORD = $env:AUTH_DB_PASSWORD

# user-service (connects + runs Liquibase as user_service, its application.yml default;
# init/02-03 create the role and grant it schema CREATE on user_db)
$env:USER_DB_URL = "jdbc:postgresql://127.0.0.1:5432/user_db"
$env:USER_DB_USER = "user_service"
$env:USER_DB_PASSWORD = $env:USER_DB_PASSWORD

# platform-admin-service
$env:PLATFORM_DB_URL = "jdbc:postgresql://127.0.0.1:5432/platform_db"
$env:PLATFORM_DB_USER = "platform_user"
$env:PLATFORM_DB_PASSWORD = $env:PLATFORM_DB_PASSWORD

# audit-service (Liquibase uses postgres superuser; runtime uses audit_writer,
# the INSERT-only role the migrations grant privileges to)
$env:AUDIT_DB_URL = "jdbc:postgresql://127.0.0.1:5432/audit_db"
$env:AUDIT_DB_USER = "audit_writer"
$env:AUDIT_DB_PASSWORD = $env:AUDIT_DB_PASSWORD
$env:AUDIT_DB_ADMIN_URL = "jdbc:postgresql://127.0.0.1:5432/audit_db"
$env:AUDIT_DB_ADMIN_USER = $env:POSTGRES_SUPERUSER
$env:AUDIT_DB_ADMIN_PASSWORD = $env:POSTGRES_SUPERUSER_PASSWORD

# file-service (connects + runs Liquibase as file_service, its application.yml default)
$env:FILE_DB_URL = "jdbc:postgresql://127.0.0.1:5432/file_db"
$env:FILE_DB_USER = "file_service"
$env:FILE_DB_PASSWORD = $env:FILE_DB_PASSWORD

# finance-service (Flyway + runtime as finance_user). NOTE: finance-service reads
# EUREKA_URI / JWKS_URI / CONFIG_URI (distinct names from EUREKA_URL above), so set
# them to localhost for host-run mode. FINANCE_DB_PASSWORD comes from deploy/.env.
$env:FINANCE_DB_URL = "jdbc:postgresql://127.0.0.1:5432/finance_db"
$env:FINANCE_DB_USER = "finance_user"
$env:FINANCE_DB_PASSWORD = $env:FINANCE_DB_PASSWORD
$env:EUREKA_URI = "http://127.0.0.1:8761/eureka/"
$env:JWKS_URI = "http://127.0.0.1:8081/.well-known/jwks.json"
$env:PLATFORM_ADMIN_URI = "http://127.0.0.1:8083"
$env:CONFIG_URI = "http://127.0.0.1:8888"
$env:FAIL_OPEN_ON_PLATFORM_DOWN = "true"

# crm-service (Liquibase + runtime as crm_user). LIQUIBASE_CONTEXTS=seed is required or the
# loyalty tier config (BRONZE/SILVER/GOLD thresholds) is never inserted.
$env:CRM_DB_URL = "jdbc:postgresql://127.0.0.1:5432/crm_db"
$env:CRM_DB_USER = "crm_user"
$env:CRM_DB_PASSWORD = $env:CRM_DB_PASSWORD
$env:LIQUIBASE_CONTEXTS = "seed"

# pos-service (Liquibase + runtime as pos_user) — publisher of ORDER_CLOSED / ORDER_REFUNDED
$env:POS_DB_URL = "jdbc:postgresql://127.0.0.1:5432/pos_db"
$env:POS_DB_USER = "pos_user"
$env:POS_DB_PASSWORD = $env:POS_DB_PASSWORD

# RabbitMQ credentials: services read RABBITMQ_USERNAME/RABBITMQ_PASSWORD (both come from
# deploy/.env, loaded above). Default 'guest' only works on loopback, so be explicit.
$env:RABBITMQ_USERNAME = $env:RABBITMQ_USERNAME
$env:RABBITMQ_PASSWORD = $env:RABBITMQ_PASSWORD

Write-Host "Loaded deploy/.env + localhost service overrides" -ForegroundColor Green
