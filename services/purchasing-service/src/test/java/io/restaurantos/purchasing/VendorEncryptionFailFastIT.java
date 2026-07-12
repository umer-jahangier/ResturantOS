package io.restaurantos.purchasing;

import io.restaurantos.purchasing.dto.CreateVendorRequest;
import io.restaurantos.purchasing.dto.VendorDto;
import io.restaurantos.purchasing.config.EncryptionRequiredConfig;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.VendorService;
import io.restaurantos.shared.config.EncryptionAutoConfiguration;
import io.restaurantos.shared.security.EncryptionService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Proves that a missing field-encryption key is a loud STARTUP failure, and that (with the key
 * set, the normal path) a vendor bank account is NEVER persisted in plaintext.
 *
 * <p>See {@link EncryptionRequiredConfig} for why the null-out-on-missing-key branch that used to
 * live in {@code VendorService.apply} was removed.
 */
class VendorEncryptionFailFastIT extends PurchasingTestBase {

    @Autowired
    private VendorService vendorService;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private TenantContext tenantContext;

    @Autowired
    private EncryptionService encryptionService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void setUp() {
        tenantContext.set(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
    }

    /**
     * A minimal, real Spring context (no testcontainers, no full app) wired with exactly the two
     * relevant configuration classes: the opt-in {@code EncryptionAutoConfiguration} (decision
     * 02-02, only registers the {@code EncryptionService} bean when the key property is present)
     * and {@code EncryptionRequiredConfig} (this plan's startup guard). This proves the guard,
     * not the whole app, refuses to start without the key — and that the failure names the
     * property an operator needs to set.
     */
    @Test
    void contextFailsToStart_whenEncryptionKeyMissing() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(EncryptionAutoConfiguration.class))
                .withUserConfiguration(EncryptionRequiredConfig.class)
                .withPropertyValues("restaurantos.encryption.key=")
                .run(context -> {
                    assertThat(context).hasFailed();
                    Throwable failure = context.getStartupFailure();
                    assertThat(failure).isNotNull();
                    // Walk the whole cause chain: Spring may or may not wrap our IllegalStateException
                    // depending on where in the refresh lifecycle it surfaces. Either way, SOMEWHERE in
                    // the chain must be our actionable message naming the property to set.
                    boolean actionableMessageFound = false;
                    for (Throwable t = failure; t != null; t = t.getCause()) {
                        if (t instanceof IllegalStateException
                                && t.getMessage() != null
                                && t.getMessage().contains("restaurantos.encryption.key")) {
                            actionableMessageFound = true;
                            break;
                        }
                    }
                    assertThat(actionableMessageFound)
                            .as("startup failure chain must contain an IllegalStateException naming "
                                    + "restaurantos.encryption.key, chain was: %s", failure)
                            .isTrue();
                });
    }

    /**
     * Negative control for the assertion above: with the key SET, the same two configuration
     * classes start cleanly and the {@code EncryptionService} bean exists.
     */
    @Test
    void contextStartsCleanly_whenEncryptionKeyPresent() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(EncryptionAutoConfiguration.class))
                .withUserConfiguration(EncryptionRequiredConfig.class)
                .withPropertyValues("restaurantos.encryption.key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(EncryptionService.class);
                });
    }

    @Test
    void bankAccountIsNeverPersistedInPlaintext() {
        String plaintext = "1234567890123456";
        VendorDto dto = vendorService.create(new CreateVendorRequest(
                "Fresh Foods Ltd", "Ali", "03001234567", null, null,
                "NET30", null, null, 3, plaintext, null));

        // 1. VendorDto returned by the API never contains the full account number.
        assertThat(dto.bankAccountLast4()).isEqualTo("3456");

        // 2. The raw DB column is not the plaintext, and it is not blank.
        String rawColumn = jdbcTemplate.queryForObject(
                "select bank_account_no from vendors where id = ?", String.class, dto.id());
        assertThat(rawColumn).isNotBlank();
        assertThat(rawColumn).isNotEqualTo(plaintext);

        // 3. It decrypts back to the original plaintext through EncryptionService.
        byte[] ciphertext = Base64.getDecoder().decode(rawColumn);
        assertThat(encryptionService.decrypt(ciphertext)).isEqualTo(plaintext);

        // 4. bankAccountLast4 matches the last 4 digits of the original number.
        Vendor saved = vendorRepository.findById(dto.id()).orElseThrow();
        assertThat(saved.getBankAccountLast4()).isEqualTo("3456");
    }
}
