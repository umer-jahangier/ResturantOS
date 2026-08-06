FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY target/hr-service-*.jar app.jar
EXPOSE 8088
ENTRYPOINT ["java", "-jar", "app.jar"]
