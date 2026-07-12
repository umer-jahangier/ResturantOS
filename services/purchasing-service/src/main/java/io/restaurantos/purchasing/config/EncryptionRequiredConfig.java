package io.restaurantos.purchasing.config;

import io.restaurantos.shared.security.EncryptionService;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.annotation.Configuration;

/**
 * Fails purchasing-service startup FAST and LOUD if the field-encryption key is not configured.
 *
 * <p>purchasing-service persists vendor bank accounts field-encrypted (PUR-01). {@code
 * EncryptionService} ships from shared-lib behind an opt-in auto-configuration keyed on {@code
 * restaurantos.encryption.key} (decision 02-02) — if the property is unset/blank the bean simply
 * does not exist. {@code VendorService} declares {@code EncryptionService} as a REQUIRED
 * constructor dependency, so Spring would eventually fail context startup on its own with a
 * generic {@code NoSuchBeanDefinitionException} — but that message does not name the property an
 * operator needs to set, and its timing depends on singleton instantiation order.
 *
 * <p>This {@link BeanFactoryPostProcessor} runs during the {@code invokeBeanFactoryPostProcessors}
 * phase — after {@code @Configuration} classes (including the conditional {@code
 * EncryptionAutoConfiguration}) have registered or skipped their bean definitions, but before ANY
 * singleton (including {@code VendorService}) is instantiated. That guarantees this check always
 * runs and always produces an actionable message, regardless of bean creation order.
 */
@Configuration
public class EncryptionRequiredConfig implements BeanFactoryPostProcessor {

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) throws BeansException {
        String[] beanNames = beanFactory.getBeanNamesForType(EncryptionService.class);
        if (beanNames.length == 0) {
            throw new IllegalStateException(
                    "purchasing-service stores field-encrypted vendor bank accounts (PUR-01) and "
                            + "requires restaurantos.encryption.key to be set. Refusing to start.");
        }
    }
}
