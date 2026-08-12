package io.restaurantos.nlq.settings;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.nlq.provider.AiProviderType;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.lang.reflect.RecordComponent;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * "The API NEVER returns the key" as a checked property of the TYPES, not of one sampled response.
 *
 * <h3>Why assert over the type rather than over a JSON body</h3>
 *
 * <p>A test that serialises one hand-built {@link AiSettingsView} and greps the string proves only
 * that <i>that instance</i> had no key in it. Someone adding an {@code apiKey} component later
 * would have to also update the fixture for the test to notice — and they would, because the
 * fixture would not compile. But they might instead add a getter, or a second DTO, and the grep
 * would pass.
 *
 * <p>Asserting over {@code getRecordComponents()} and over the entity's declared methods makes the
 * guarantee structural: there is no component, and no accessor, that can carry a plaintext key.
 * Adding one fails here regardless of what any particular response happens to contain.
 */
class AiSettingsNoKeyLeakTest {

    /** A fake key. Present in this file only as a string to assert the ABSENCE of. */
    private static final String FAKE_KEY = "sk-ant-TEST-not-a-real-key-000000000000";

    /** Anything whose name suggests it might hand back a credential. */
    private static final List<String> FORBIDDEN_NAME_FRAGMENTS =
            List.of("apikey", "plaintext", "secret", "credential", "token", "reveal");

    @Test
    @DisplayName("AiSettingsView has no component that could carry the key")
    void viewHasNoKeyComponent() {
        List<String> componentNames = Arrays.stream(AiSettingsView.class.getRecordComponents())
                .map(RecordComponent::getName)
                .toList();

        // Positive control: the record must actually have components, or the loop below is vacuous.
        assertThat(componentNames)
                .as("AiSettingsView must have components for this test to mean anything")
                .isNotEmpty()
                .contains("provider", "source", "keyLast4", "keyState");

        for (String name : componentNames) {
            String lower = name.toLowerCase();
            // keyLast4 and keyState are permitted: four characters and an enum, neither reversible.
            if (lower.equals("keylast4") || lower.equals("keystate")) {
                continue;
            }
            assertThat(FORBIDDEN_NAME_FRAGMENTS.stream().anyMatch(lower::contains))
                    .as("""
                        AiSettingsView gained the component '%s'. The AI-settings API must never \
                        return the key: no key field, no reveal endpoint, no ?includeKey. If a \
                        genuine need for a new field exists, it must not be key-derived beyond the \
                        4-character hint.""".formatted(name))
                    .isFalse();
        }
    }

    @Test
    @DisplayName("a fully-populated view serialises to JSON that contains no key")
    void serialisedViewContainsNoKey() throws Exception {
        AiSettingsView view = new AiSettingsView(
                AiProviderType.ANTHROPIC, CredentialSource.TENANT, "0000", KeyState.VERIFIED,
                Instant.now(), null, Instant.now(), UUID.randomUUID(), true, true);

        // JSR310 registered explicitly: a bare ObjectMapper cannot serialise Instant, and Spring
        // Boot's auto-configured one (which serves the real endpoint) has this module already.
        String json = new ObjectMapper()
                .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule())
                .writeValueAsString(view);

        // Positive control: prove the mask IS present, so "does not contain the key" is not
        // passing because the body is empty or the serialisation silently failed.
        assertThat(json).as("the masked hint must be present").contains("0000");
        assertThat(json).doesNotContain(FAKE_KEY);
        assertThat(json.toLowerCase()).doesNotContain("apikey");
    }

    @Test
    @DisplayName("the entity exposes no accessor that returns a plaintext key")
    void entityHasNoPlaintextAccessor() {
        List<String> suspicious = Arrays.stream(TenantAiSettingsEntity.class.getDeclaredMethods())
                .filter(m -> m.getReturnType() == String.class)
                .map(Method::getName)
                .filter(n -> {
                    String lower = n.toLowerCase();
                    // last4 and fingerprint are both non-reversible and neither is returned by the
                    // API in the fingerprint's case.
                    if (lower.contains("last4") || lower.contains("fingerprint")) {
                        return false;
                    }
                    return FORBIDDEN_NAME_FRAGMENTS.stream().anyMatch(lower::contains);
                })
                .toList();

        assertThat(suspicious)
                .as("""
                    TenantAiSettingsEntity gained a String accessor that looks like it returns a \
                    credential: %s. The entity holds ciphertext ONLY — it must have no field and \
                    no getter that materialises the plaintext key, which is what makes an \
                    accidental ApiResponse.ok(entity) harmless. Decryption belongs in AiKeyCipher, \
                    reached only through LlmCredentialResolver.""".formatted(suspicious))
                .isEmpty();
    }

    @Test
    @DisplayName("the request DTO's toString suppresses the submitted key")
    void requestToStringSuppressesTheKey() {
        UpdateAiSettingsRequest request = new UpdateAiSettingsRequest("ANTHROPIC", FAKE_KEY);

        // A record's generated toString prints every component. An unhandled-exception log or a
        // validation failure that interpolates the request would otherwise print the key.
        assertThat(request.toString()).doesNotContain(FAKE_KEY).contains("apiKey=***");
    }

    @Test
    @DisplayName("last4 returns four characters and never the whole key")
    void last4IsFourCharacters() {
        // Blank key: no field encryption configured. last4 must still work — it is pure
        // string arithmetic and never touches the cipher.
        AiKeyCipher cipher = new AiKeyCipher("");

        String hint = cipher.last4(FAKE_KEY);

        assertThat(hint).hasSize(4);
        assertThat(FAKE_KEY).endsWith(hint);
        // Not "the first 7 and the last 4" — an earlier attempt at this feature returned the
        // provider prefix as well, which is key material the caller did not need.
        assertThat(hint).doesNotContain("sk-ant");
    }
}
