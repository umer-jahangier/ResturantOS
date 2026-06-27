FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /build

COPY pom.xml .
COPY shared-lib/pom.xml shared-lib/pom.xml
COPY eureka-server/pom.xml eureka-server/pom.xml
COPY config-server/pom.xml config-server/pom.xml
COPY services/auth-service/pom.xml services/auth-service/pom.xml
COPY services/finance-service/pom.xml services/finance-service/pom.xml

RUN mvn -pl services/auth-service -am -q dependency:go-offline -DskipTests || true

COPY shared-lib/src shared-lib/src
COPY services/auth-service/src services/auth-service/src

RUN mvn -pl services/auth-service -am -q -DskipTests package

FROM eclipse-temurin:25-jre
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/services/auth-service/target/auth-service-*.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "/app.jar"]
