package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.RecoveryCodeEntity;
import io.restaurantos.auth.repository.RecoveryCodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RecoveryCodeServiceTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID TENANT = UUID.randomUUID();

    private RecoveryCodeRepository repository;
    private RecoveryCodeService service;

    @BeforeEach
    void setUp() {
        repository = mock(RecoveryCodeRepository.class);
        service = new RecoveryCodeService(repository);
    }

    // ---------------------------------------------------------------- issuing

    @Test
    @DisplayName("issues ten distinct codes and persists a hash for each")
    void regenerateIssuesTenDistinctCodes() {
        List<String> codes = service.regenerate(USER, TENANT);

        assertThat(codes).hasSize(10).doesNotHaveDuplicates();
        ArgumentCaptor<RecoveryCodeEntity> saved = ArgumentCaptor.forClass(RecoveryCodeEntity.class);
        verify(repository, org.mockito.Mockito.times(10)).save(saved.capture());
        assertThat(saved.getAllValues())
            .allSatisfy(e -> {
                assertThat(e.getUserId()).isEqualTo(USER);
                assertThat(e.getTenantId()).isEqualTo(TENANT);
                assertThat(e.getUsedAt()).isNull();
                assertThat(e.getCodeHash()).hasSize(64).matches("[0-9a-f]{64}");
            })
            .extracting(RecoveryCodeEntity::getCodeHash)
            .doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("the stored value is a hash, never the code itself")
    void storesOnlyHashes() {
        List<String> codes = service.regenerate(USER, TENANT);

        ArgumentCaptor<RecoveryCodeEntity> saved = ArgumentCaptor.forClass(RecoveryCodeEntity.class);
        verify(repository, org.mockito.Mockito.times(10)).save(saved.capture());
        Set<String> hashes = new HashSet<>();
        saved.getAllValues().forEach(e -> hashes.add(e.getCodeHash()));

        for (String code : codes) {
            assertThat(hashes).doesNotContain(code);
            assertThat(hashes).contains(sha256Hex(code.replace("-", "")));
        }
    }

    @Test
    @DisplayName("regeneration clears the old set BEFORE writing the new one")
    void regenerateDeletesFirst() {
        service.regenerate(USER, TENANT);

        InOrder order = inOrder(repository);
        order.verify(repository).deleteAllForUser(USER);
        order.verify(repository, org.mockito.Mockito.times(10)).save(any(RecoveryCodeEntity.class));
    }

    @Test
    @DisplayName("codes avoid I, O, 0 and 1 — the characters people transcribe wrongly")
    void codesUseUnambiguousAlphabetOnly() {
        for (String code : service.regenerate(USER, TENANT)) {
            assertThat(code).matches("[A-Z2-9]{5}-[A-Z2-9]{5}");
            assertThat(code.replace("-", "")).doesNotContain("I", "O", "0", "1");
        }
    }

    // ------------------------------------------------------------ shape rules

    @Test
    @DisplayName("a generated code is recognised as a recovery code")
    void generatedCodesAreRecognised() {
        assertThat(service.regenerate(USER, TENANT))
            .allMatch(RecoveryCodeService::looksLikeRecoveryCode);
    }

    @ParameterizedTest
    @DisplayName("a six-digit TOTP code is never mistaken for a recovery code")
    @ValueSource(strings = {"000000", "123456", "999999", "010101"})
    void totpCodesAreNotRecoveryCodes(String totp) {
        assertThat(RecoveryCodeService.looksLikeRecoveryCode(totp)).isFalse();
    }

    @ParameterizedTest
    @DisplayName("junk of the wrong length or alphabet is rejected on shape")
    @ValueSource(strings = {"", "   ", "ABCDE-ABCD", "ABCDE-ABCDEF", "IIIII-IIIII", "OOOOO-OOOOO",
                            "00000-00000", "11111-11111", "abcde-!!!!!"})
    void malformedIsNotARecoveryCode(String candidate) {
        assertThat(RecoveryCodeService.looksLikeRecoveryCode(candidate)).isFalse();
    }

    @Test
    @DisplayName("null never blows up the shape check")
    void nullIsNotARecoveryCode() {
        assertThat(RecoveryCodeService.looksLikeRecoveryCode(null)).isFalse();
    }

    // -------------------------------------------------------------- redeeming

    @Test
    @DisplayName("a code typed without the hyphen, in lower case, or with spaces still redeems")
    void redemptionNormalisesUserTyping() {
        when(repository.redeem(eq(USER), anyString())).thenReturn(1);
        String code = service.regenerate(USER, TENANT).get(0);
        String bare = code.replace("-", "");

        assertThat(service.redeem(USER, code)).isTrue();
        assertThat(service.redeem(USER, bare)).isTrue();
        assertThat(service.redeem(USER, bare.toLowerCase())).isTrue();
        assertThat(service.redeem(USER, " " + code + " ")).isTrue();

        // every spelling hashes to the same digest the issuer stored
        ArgumentCaptor<String> hashes = ArgumentCaptor.forClass(String.class);
        verify(repository, org.mockito.Mockito.times(4)).redeem(eq(USER), hashes.capture());
        assertThat(hashes.getAllValues()).containsOnly(sha256Hex(bare));
    }

    @Test
    @DisplayName("a spent or unknown code is refused — the UPDATE matched no row")
    void redemptionFailsWhenNothingWasBurned() {
        when(repository.redeem(eq(USER), anyString())).thenReturn(0);
        assertThat(service.redeem(USER, "ABCDE-FGHJK")).isFalse();
    }

    @Test
    @DisplayName("malformed input never reaches the database")
    void malformedRedemptionShortCircuits() {
        assertThat(service.redeem(USER, "123456")).isFalse();
        assertThat(service.redeem(USER, null)).isFalse();
        assertThat(service.redeem(USER, "")).isFalse();
        verify(repository, never()).redeem(any(), anyString());
    }

    private static String sha256Hex(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256")
                .digest(s.toUpperCase(java.util.Locale.ROOT).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
