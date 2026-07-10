# Stage 1: Build the JAR using the full Maven + JDK image.
# Build context must be the repository root so the parent POM and module sources are available.
FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /build

# Copy parent POM first so Maven can resolve the reactor
COPY pom.xml .

# Copy only the modules needed for this build to maximise layer cache hits
COPY shared-lib/pom.xml shared-lib/pom.xml
COPY eureka-server/pom.xml eureka-server/pom.xml
COPY config-server/pom.xml config-server/pom.xml
COPY services/auth-service/pom.xml services/auth-service/pom.xml
COPY services/authorization-service/pom.xml services/authorization-service/pom.xml
COPY gateway/pom.xml gateway/pom.xml
COPY services/user-service/pom.xml services/user-service/pom.xml
COPY services/platform-admin-service/pom.xml services/platform-admin-service/pom.xml
COPY services/notification-service/pom.xml services/notification-service/pom.xml
COPY services/audit-service/pom.xml services/audit-service/pom.xml
COPY services/file-service/pom.xml services/file-service/pom.xml
COPY services/finance-service/pom.xml services/finance-service/pom.xml
COPY services/pos-service/pom.xml services/pos-service/pom.xml
COPY services/kitchen-service/pom.xml services/kitchen-service/pom.xml

# Pre-download dependencies (runs before sources are copied)
RUN mvn -pl gateway -am -q dependency:go-offline -DskipTests || true

# Copy source trees
COPY shared-lib/src shared-lib/src
COPY gateway/src gateway/src

# Build — include shared-lib (-am) and skip tests
RUN mvn -pl gateway -am -q -DskipTests package

# Stage 2: Minimal JRE runtime image
FROM eclipse-temurin:25-jre
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/gateway/target/gateway-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
