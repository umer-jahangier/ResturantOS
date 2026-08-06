FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY target/reporting-service-*.jar app.jar
EXPOSE 8092
ENTRYPOINT ["java", "-jar", "app.jar"]
