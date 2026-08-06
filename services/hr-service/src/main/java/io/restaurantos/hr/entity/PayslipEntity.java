package io.restaurantos.hr.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;
import java.util.UUID;

/**
 * One employee's payslip within a run. {@code deductionsJson} follows the RESEARCH shape:
 * income_tax_paisa, eobi_employee_paisa, advances_paisa, late_arrival_paisa, other. Amounts are paisa.
 */
@Entity
@Table(name = "payslips")
@Getter
@Setter
public class PayslipEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "basic_paisa", nullable = false)
    private long basicPaisa;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "allowances_json", nullable = false, columnDefinition = "jsonb")
    private Map<String, Long> allowancesJson;

    @Column(name = "gross_paisa", nullable = false)
    private long grossPaisa;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "deductions_json", nullable = false, columnDefinition = "jsonb")
    private Map<String, Long> deductionsJson;

    @Column(name = "net_paisa", nullable = false)
    private long netPaisa;

    @Column(name = "payslip_file_id")
    private UUID payslipFileId;
}
