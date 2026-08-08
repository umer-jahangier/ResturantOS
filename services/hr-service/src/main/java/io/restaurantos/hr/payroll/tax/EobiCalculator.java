package io.restaurantos.hr.payroll.tax;

import org.springframework.stereotype.Component;

/**
 * EOBI contributions. Both signatures take ONLY the statutory wage base — never an employee
 * salary — because Pakistan EOBI is a fixed percentage of the notified minimum wage, identical
 * for every covered employee regardless of their pay (see 11-RESEARCH Pitfall 4).
 */
@Component
public class EobiCalculator {

    public long employeeContribution(long eobiWageBasePaisa, double employeeRatePct) {
        return Math.round(eobiWageBasePaisa * employeeRatePct / 100.0);
    }

    public long employerContribution(long eobiWageBasePaisa, double employerRatePct) {
        return Math.round(eobiWageBasePaisa * employerRatePct / 100.0);
    }
}
