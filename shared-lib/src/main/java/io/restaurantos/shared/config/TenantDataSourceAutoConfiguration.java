package io.restaurantos.shared.config;

import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Role;
import org.springframework.beans.factory.config.BeanDefinition;

import javax.sql.DataSource;

/** Registers {@link TenantAwareDataSourcePostProcessor} for tenant RLS GUC at JDBC checkout. */
@AutoConfiguration
@ConditionalOnClass(DataSource.class)
public class TenantDataSourceAutoConfiguration {

    @Bean
    @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    static TenantAwareDataSourcePostProcessor tenantAwareDataSourcePostProcessor(TenantContext tenantContext) {
        return new TenantAwareDataSourcePostProcessor(tenantContext);
    }
}
