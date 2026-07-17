package io.restaurantos.nlq.config;

import io.restaurantos.nlq.allowlist.AllowedTableService;
import io.restaurantos.nlq.validation.SqlValidationPipeline;
import io.restaurantos.nlq.validation.stage.AstParseStage;
import io.restaurantos.nlq.validation.stage.BranchFilterStage;
import io.restaurantos.nlq.validation.stage.LimitInjectStage;
import io.restaurantos.nlq.validation.stage.PiiDenylistStage;
import io.restaurantos.nlq.validation.stage.ShapeCheckStage;
import io.restaurantos.nlq.validation.stage.TableAllowlistStage;
import io.restaurantos.nlq.validation.stage.TenantFilterStage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Wires the 12-04 {@link SqlValidationPipeline} as a Spring bean for 12-07's {@code NlqService}.
 * 12-04 deliberately left the pipeline framework-agnostic (constructed with {@code new} in its own
 * tests, see {@code TestPipelines}) — this is the ONE place it becomes a managed bean, using the
 * exact same configuration keys ({@code restaurantos.nlq.pii-denylist},
 * {@code restaurantos.nlq.default-limit}, {@code restaurantos.nlq.max-result-rows}) the validator
 * package's own tests mirror.
 *
 * <p>This class does not modify a single line of the validator itself — see the plan's hard
 * constraint to REUSE, not reimplement or bypass, 12-04's pipeline.
 */
@Configuration
public class NlqValidationConfig {

    @Bean
    public SqlValidationPipeline sqlValidationPipeline(
            AllowedTableService allowedTableService,
            @Value("${restaurantos.nlq.pii-denylist}") List<String> piiDenylist,
            @Value("${restaurantos.nlq.default-limit}") long defaultLimit,
            @Value("${restaurantos.nlq.max-result-rows}") long maxResultRows) {
        return new SqlValidationPipeline(
                new ShapeCheckStage(),
                new AstParseStage(),
                new TableAllowlistStage(allowedTableService),
                new PiiDenylistStage(piiDenylist),
                new TenantFilterStage(),
                new BranchFilterStage(),
                new LimitInjectStage(defaultLimit, maxResultRows));
    }
}
