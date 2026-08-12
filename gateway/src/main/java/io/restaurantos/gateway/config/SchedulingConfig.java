package io.restaurantos.gateway.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Turns on {@code @Scheduled}, which the gateway needs for exactly one thing:
 * {@link io.restaurantos.gateway.ops.FleetHealthMonitor}'s probe loop.
 *
 * <p>Its own class rather than an annotation on {@code GatewayApplication} so that "the gateway
 * runs a background loop" is a decision with a file and a reason attached, and so a future reader
 * looking for what schedules work in an edge proxy finds it immediately.
 */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
