package io.restaurantos.purchasing.config;

import io.restaurantos.shared.security.EncryptionService;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.EnvironmentAware;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * Fails purchasing-service startup FAST and LOUD if the field-encryption key is not configured.
 *
 * <p>purchasing-service persists vendor bank accounts field-encrypted (PUR-01). {@code
 * EncryptionService} ships from shared-lib behind an opt-in auto-configuration keyed on {@code
 * restaurantos.encryption.key} (decision 02-02). Two distinct failure modes have to be caught:
 *
 * <ol>
 *   <li>The property is entirely UNSET — {@code @ConditionalOnProperty} skips the bean, so it is
 *       absent from the bean factory.
 *   <li>The property is set to a BLANK string — {@code @ConditionalOnProperty} treats a present
 *       (even empty) value as satisfying the condition, so the bean definition IS registered, but
 *       {@code EncryptionService}'s constructor later throws an unrelated, unhelpful {@code
 *       IllegalArgumentException("Empty key")} deep inside {@code SecretKeySpec} the first time a
 *       vendor is created — not an actionable startup failure.
 * </ol>
 *
 * <p>This {@link BeanFactoryPostProcessor} checks BOTH conditions directly against the {@link
 * Environment} and the bean factory. It runs during the {@code invokeBeanFactoryPostProcessors}
 * phase — after {@code @Configuration} classes have registered or skipped their bean definitions,
 * but before ANY singleton (including {@code VendorService} or {@code EncryptionService} itself)
 * is instantiated — so it always wins the race and always produces an actionable message.
 */
@Configuration
public class EncryptionRequiredConfig implements BeanFactoryPostProcessor, EnvironmentAware {

    private static final String KEY_PROPERTY = "restaurantos.encryption.key";

    private Environment environment;

    @Override
    public void setEnvironment(Environment environment) {
        this.environment = environment;
    }

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) throws BeansException {
        String key = environment.getProperty(KEY_PROPERTY);
        boolean beanRegistered = beanFactory.getBeanNamesForType(EncryptionService.class).length > 0;
        if (key == null || key.isBlank() || !beanRegistered) {
            throw new IllegalStateException(
                    "purchasing-service stores field-encrypted vendor bank accounts (PUR-01) and "
                            + "requires " + KEY_PROPERTY + " to be set. Refusing to start.");
        }
    }
}
