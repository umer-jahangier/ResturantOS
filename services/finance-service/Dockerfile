FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /build

COPY pom.xml .
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

RUN mvn -pl services/finance-service -am -q dependency:go-offline -DskipTests || true

COPY shared-lib/src shared-lib/src
COPY services/finance-service/src services/finance-service/src

RUN mvn -pl services/finance-service -am -q -DskipTests package

FROM eclipse-temurin:25-jre
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/services/finance-service/target/finance-service-*.jar app.jar
EXPOSE 8086
ENTRYPOINT ["java", "-jar", "/app.jar"]
