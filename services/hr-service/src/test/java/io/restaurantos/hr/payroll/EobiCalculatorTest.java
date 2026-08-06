package io.restaurantos.hr.payroll;

import io.restaurantos.hr.payroll.tax.EobiCalculator;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * EOBI is a fixed percentage of the statutory minimum wage, not the employee's salary.
 */
class EobiCalculatorTest {

    private final EobiCalculator calc = new EobiCalculator();

    private static final long WAGE_BASE_PAISA = 3700000L; // Rs 37,000 statutory minimum wage

    @Test
    void employeeContribution_isOnePercentOfWageBase() {
        assertThat(calc.employeeContribution(WAGE_BASE_PAISA, 1.0)).isEqualTo(37000L); // Rs 370
    }

    @Test
    void employerContribution_isFivePercentOfWageBase() {
        assertThat(calc.employerContribution(WAGE_BASE_PAISA, 5.0)).isEqualTo(185000L); // Rs 1,850
    }

    @Test
    void eobi_isSalaryIndependent_byDesign() {
        // There is no salary parameter in either signature — EOBI cannot vary with pay. This test
        // documents that a Rs 200,000/month employee and a Rs 40,000/month employee owe identical EOBI.
        assertThat(calc.employeeContribution(WAGE_BASE_PAISA, 1.0)).isEqualTo(37000L);
        assertThat(calc.employerContribution(WAGE_BASE_PAISA, 5.0)).isEqualTo(185000L);
    }
}
