package io.restaurantos.shared.config;

import io.restaurantos.shared.tenant.TenantAwareDataSource;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;

import javax.sql.DataSource;

/**
 * Wraps the application {@link DataSource} so tenant GUC is set at JDBC checkout.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
public class TenantAwareDataSourcePostProcessor implements BeanPostProcessor {

    private final TenantContext tenantContext;

    public TenantAwareDataSourcePostProcessor(TenantContext tenantContext) {
        this.tenantContext = tenantContext;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
        if (bean instanceof DataSource dataSource && !(dataSource instanceof TenantAwareDataSource)) {
            return new TenantAwareDataSource(dataSource, tenantContext);
        }
        return bean;
    }
}
