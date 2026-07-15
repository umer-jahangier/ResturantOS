FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY target/crm-service-*.jar app.jar
EXPOSE 8089
ENTRYPOINT ["java", "-jar", "app.jar"]
