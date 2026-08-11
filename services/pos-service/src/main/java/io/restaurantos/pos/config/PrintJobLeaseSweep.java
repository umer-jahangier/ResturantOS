package io.restaurantos.pos.config;

import io.restaurantos.pos.service.PrintJobClaimService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Returns expired agent claims to the queue, on a timer.
 *
 * <p><b>A top-level class, deliberately.</b> It began life as a static nested {@code @Component}
 * inside {@code PrintAgentSecurityConfig} and its {@code @ConditionalOnProperty} did not take
 * effect there — the sweep kept running in a test that had switched it off, incremented a job's
 * attempt count a second time between the assertion's two lines, and produced a failure that read
 * like a logic bug in the reclaim. Found by that test failing; recorded here so nobody folds it
 * back in.
 *
 * <p>Switched off in tests that assert on lease expiry, because a background timer racing an
 * assertion produces a suite that passes on a fast machine and fails on a busy one. Those tests
 * call {@link PrintJobClaimService#reclaimExpiredLeases()} directly with a controlled clock, which
 * is also the only way to advance time without sleeping through a two-minute lease.
 */
@Component
@ConditionalOnProperty(name = "restaurantos.print.sweep.enabled", havingValue = "true",
        matchIfMissing = true)
public class PrintJobLeaseSweep {

    private final PrintJobClaimService claimService;

    public PrintJobLeaseSweep(PrintJobClaimService claimService) {
        this.claimService = claimService;
    }

    @Scheduled(fixedDelayString = "${restaurantos.print.sweep-interval-ms:30000}")
    public void sweep() {
        claimService.reclaimExpiredLeases();
    }
}
