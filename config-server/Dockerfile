# Stage 1: Build the JAR using the full Maven + JDK image.
# Build context must be the repository root so the parent POM and module sources are available.
FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /build

# Copy parent POM first so Maven can resolve the reactor
COPY pom.xml .

# Copy ALL module POMs the parent reactor declares. Maven's reactor validates every
# <module> in the parent pom.xml even with -pl/-am, so all child POMs must be present
# or the build fails with "Child module ... does not exist".
COPY shared-lib/pom.xml shared-lib/pom.xml
COPY eureka-server/pom.xml eureka-server/pom.xml
COPY config-server/pom.xml config-server/pom.xml
COPY gateway/pom.xml gateway/pom.xml
COPY services/auth-service/pom.xml services/auth-service/pom.xml
COPY services/authorization-service/pom.xml services/authorization-service/pom.xml
COPY services/user-service/pom.xml services/user-service/pom.xml
COPY services/platform-admin-service/pom.xml services/platform-admin-service/pom.xml
COPY services/notification-service/pom.xml services/notification-service/pom.xml
COPY services/audit-service/pom.xml services/audit-service/pom.xml
COPY services/file-service/pom.xml services/file-service/pom.xml
COPY services/finance-service/pom.xml services/finance-service/pom.xml

# Pre-download dependencies (runs before sources are copied)
RUN mvn -pl config-server -am -q dependency:go-offline -DskipTests || true

# Copy source trees
COPY shared-lib/src shared-lib/src
COPY config-server/src config-server/src

# Build — include shared-lib (-am) and skip tests
RUN mvn -pl config-server -am -q -DskipTests package

# Stage 2: Minimal JRE runtime image (wget for compose healthcheck)
FROM eclipse-temurin:25-jre
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/config-server/target/config-server-*.jar app.jar
EXPOSE 8888
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
