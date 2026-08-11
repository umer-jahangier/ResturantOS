package io.restaurantos.pos.config;

import io.restaurantos.pos.service.PrintJobClaimService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.time.Clock;

/**
 * The print agent's slice of the security model, and the lease sweep that keeps it honest.
 *
 * <h2>What is NOT here</h2>
 *
 * <p>No {@code permitAll} for the agent paths. {@link PrintAgentCredentialFilter} sets an
 * authentication carrying one authority and {@code PrintAgentController} requires exactly that
 * authority, so the paths stay under {@code anyRequest().authenticated()} in
 * {@code PosSecurityConfig} like everything else. A {@code permitAll} entry would mean the endpoint
 * is open and the controller is the only thing standing in front of it — which is one refactor away
 * from being open.
 *
 * <p>The filter itself is registered in {@code PosSecurityConfig}'s chain rather than as a plain
 * servlet filter, so it runs inside the security filter chain and its {@code SecurityContext}
 * survives to method security.
 *
 * <p>The lease sweep lives in {@link PrintJobLeaseSweep}, a top-level class — see its comment for
 * why it is not nested here.
 */
@Configuration
@EnableScheduling
public class PrintAgentSecurityConfig {

    /**
     * Injectable so the lease sweep can be tested by ADVANCING a clock rather than by sleeping.
     * A test that sleeps for a lease is a test nobody runs.
     */
    /**
     * The encoder for print-agent credentials.
     *
     * <p>BCrypt at cost 12 — deliberately the SAME construction auth-service uses for user
     * passwords, not a second scheme chosen here. One hashing decision in this product, made once.
     *
     * <p>It lives HERE rather than in {@code PosSecurityConfig} because that class now takes
     * {@link PrintAgentCredentialFilter} as a constructor argument, and the filter needs the
     * enrolment service, which needs this encoder. Declaring it there closes the cycle
     * {@code PosSecurityConfig -> filter -> enrolment service -> PosSecurityConfig} and the context
     * refuses to start. This class takes no constructor arguments at all, so it cannot.
     */
    @Bean
    public org.springframework.security.crypto.password.PasswordEncoder passwordEncoder() {
        return new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder(12);
    }

    @Bean
    public Clock printClock() {
        return Clock.systemUTC();
    }

}
