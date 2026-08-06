package io.restaurantos.hr.payroll.tax;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;

/**
 * EOBI contributions. Both signatures take ONLY the statutory wage base — never an employee
 * salary — because Pakistan EOBI is a fixed percentage of the notified minimum wage, identical
 * for every covered employee regardless of their pay (see 11-RESEARCH Pitfall 4).
 */
@Component
public class EobiCalculator {

    public long employeeContribution(long eobiWageBasePaisa, BigDecimal employeeRatePct) {
        return PercentOfPaisa.apply(eobiWageBasePaisa, employeeRatePct);
    }

    public long employerContribution(long eobiWageBasePaisa, BigDecimal employerRatePct) {
        return PercentOfPaisa.apply(eobiWageBasePaisa, employerRatePct);
    }
}
