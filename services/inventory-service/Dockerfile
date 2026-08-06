FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY target/inventory-service-*.jar app.jar
EXPOSE 8085
ENTRYPOINT ["java", "-jar", "app.jar"]
