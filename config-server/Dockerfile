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
