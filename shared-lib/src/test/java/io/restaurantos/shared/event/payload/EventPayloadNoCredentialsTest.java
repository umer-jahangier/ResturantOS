package io.restaurantos.shared.event.payload;

import io.restaurantos.shared.event.CredentialRedactor;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.RecordComponent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * No event payload has anywhere to put a credential.
 *
 * <h2>Why this is asserted structurally rather than reviewed</h2>
 *
 * <p>Because the places a credential would land are all durable, all replicated and all
 * unredactable. {@code event_outbox} is a plain-text table that is backed up and relayed onto a
 * broker with consumers the producing service does not control; {@code audit_events} is append-only
 * by privilege AND by trigger and is retained for seven years. A password written into either
 * cannot be taken back out — the only way to remove it is to destroy the audit history that is the
 * entire point of the table.
 *
 * <p>This has already happened once in this repository: 13-09 (D-19) removed a raw password-reset
 * token from {@code event_outbox}. The person who put it there was adding a useful field to a
 * payload, which is what this always looks like from the inside. A field named {@code tempPassword}
 * on a {@code UserCreatedPayload} would read as obviously convenient in review and would be a
 * credential in a seven-year log.
 *
 * <p>So the rule is enforced two ways here. Reflectively over every payload record, which catches a
 * field however it is spelled or typed; and over the payload sources, which additionally catches a
 * credential smuggled through a {@code Map} or a comment-free javadoc. Both are cheap and neither
 * depends on anyone remembering the rule.
 */
@DisplayName("event payloads carry no credentials")
class EventPayloadNoCredentialsTest {

    private static final Path REPO_ROOT = Path.of("..").toAbsolutePath().normalize();

    /**
     * Every payload record 15-01 introduced, plus the two credential-adjacent ones that already
     * existed — the two most likely to acquire a password field, since both are about passwords.
     */
    private static final List<Class<?>> PAYLOAD_RECORDS = List.of(
            UserLifecycleEventContract.UserCreatedPayload.class,
            UserLifecycleEventContract.UserUpdatedPayload.class,
            UserLifecycleEventContract.UserActivationChangedPayload.class,
            UserLifecycleEventContract.RoleGrantedPayload.class,
            UserLifecycleEventContract.RoleRevokedPayload.class,
            AdminPasswordResetPayload.class,
            PasswordResetRequestedPayload.class);

    @Test
    @DisplayName("no payload record declares a credential-shaped component")
    void noPayloadRecordHasACredentialField() {
        Set<String> offenders = new TreeSet<>();

        for (Class<?> type : PAYLOAD_RECORDS) {
            assertThat(type.isRecord())
                    .as("%s must be a record: a typed contract is what makes a rogue field visible "
                            + "at all, and a Map payload would defeat this whole test", type.getSimpleName())
                    .isTrue();

            for (RecordComponent component : type.getRecordComponents()) {
                if (namesCredentialMaterial(component.getName())) {
                    offenders.add(type.getSimpleName() + "." + component.getName());
                }
            }
        }

        assertThat(offenders)
                .as("""
                    Payload components whose names indicate credential material.

                    These end up in event_outbox (plain text, replicated, backed up) and then in
                    audit_events (append-only, seven-year retention). Neither can be redacted; the
                    only removal is destroying the audit record itself.

                    A credential belongs in the HTTP response to the caller who is entitled to it,
                    and nowhere else. See UserLifecycleEventContract and AdminPasswordResetPayload,
                    both of which say so and neither of which has such a field.
                    """)
                .isEmpty();
    }

    @Test
    @DisplayName("payload record components are identifiers, timestamps and enumerable facts")
    void payloadComponentsAreSafeTypes() {
        Set<String> unexpected = new TreeSet<>();
        Set<Class<?>> allowed = Set.of(
                UUID.class, String.class, Instant.class,
                boolean.class, Boolean.class, int.class, Integer.class,
                long.class, Long.class, List.class);

        for (Class<?> type : PAYLOAD_RECORDS) {
            for (RecordComponent component : type.getRecordComponents()) {
                if (!allowed.contains(component.getType())) {
                    unexpected.add(type.getSimpleName() + "." + component.getName()
                            + " : " + component.getType().getSimpleName());
                }
            }
        }

        assertThat(unexpected)
                .as("Payload components of a type this contract does not expect. A nested object "
                        + "graph is how a credential arrives without a credential-shaped NAME — the "
                        + "field is called 'user' and the object has a passwordHash on it. Keep "
                        + "payloads flat and made of identifiers.")
                .isEmpty();
    }

    @Test
    @DisplayName("no payload source assigns a credential into a map payload")
    void noPayloadSourceBuildsACredentialKey() throws IOException {
        // Map-shaped payloads still exist on older paths (LoginEventPublisher, ImpersonationService).
        // A record cannot hide a field; a Map can, so the sources are checked too.
        Pattern mapKey = Pattern.compile("(?:put|of|Map\\.entry)\\s*\\(\\s*\"([a-zA-Z_]+)\"");
        Set<String> offenders = new TreeSet<>();

        for (Path file : eventPublishingSources()) {
            String content = Files.readString(file, StandardCharsets.UTF_8);
            if (!content.contains(".publish(")) {
                continue;
            }
            Matcher m = mapKey.matcher(content);
            while (m.find()) {
                if (namesCredentialMaterial(m.group(1))) {
                    offenders.add(REPO_ROOT.relativize(file) + " → \"" + m.group(1) + "\"");
                }
            }
        }

        assertThat(offenders)
                .as("Map-payload keys naming credential material in a class that publishes events. "
                        + "13-09 (D-19) removed a raw reset token from event_outbox; this is the "
                        + "check that stops the next one from being added.")
                .isEmpty();
    }

    /**
     * The detector actually detects.
     *
     * <p>Without this, every assertion above passes trivially the moment the heuristic breaks —
     * an empty result set is exactly what "no credentials found" and "the check is broken" both
     * look like. That failure mode is the one this whole phase is about: the audit allow-list
     * matched nothing for fourteen phases and reported success the entire time.
     */
    @Test
    @DisplayName("the credential detector catches what it claims to")
    void detectorIsNotVacuous() {
        assertThat(namesCredentialMaterial("password")).isTrue();
        assertThat(namesCredentialMaterial("tempPassword")).isTrue();
        assertThat(namesCredentialMaterial("passwordHash")).isTrue();
        assertThat(namesCredentialMaterial("password_hash")).isTrue();
        assertThat(namesCredentialMaterial("token")).isTrue();
        assertThat(namesCredentialMaterial("resetToken")).isTrue();
        assertThat(namesCredentialMaterial("refreshTokenId")).isTrue();
        assertThat(namesCredentialMaterial("totpSecret")).isTrue();
        assertThat(namesCredentialMaterial("apiKey")).isTrue();
        assertThat(namesCredentialMaterial("cnic")).isTrue();
        assertThat(namesCredentialMaterial("bankAccountNo")).isTrue();

        // Handles and ordinary business identifiers, which must NOT be flagged — see
        // HANDLE_BEARING_WORDS for the two live cases that drove this distinction.
        assertThat(namesCredentialMaterial("tokenId")).isFalse();
        assertThat(namesCredentialMaterial("tillSessionId")).isFalse();
        assertThat(namesCredentialMaterial("userId")).isFalse();
        assertThat(namesCredentialMaterial("targetEmail")).isFalse();
        assertThat(namesCredentialMaterial("approvalLimitPaisa")).isFalse();
        assertThat(namesCredentialMaterial("reason")).isFalse();
    }

    /**
     * The consumer-side control, on the exact payload shape that caused the incident.
     *
     * <p>Three pre-D-19 {@code PASSWORD_RESET_REQUESTED} messages sat in the broker carrying raw
     * reset tokens. When 15-01 corrected the allow-list, the backlog drained and all three tokens
     * were written into {@code audit_events} — append-only, seven-year retention, unremovable. The
     * producer-side rule was correct and current and did not help, because the messages predated it.
     */
    @Test
    @DisplayName("a queued pre-D-19 payload is redacted before it can be stored")
    void redactorStripsTheTokenThatReachedTheAppendOnlyTable() {
        Object redacted = CredentialRedactor.redact(new java.util.LinkedHashMap<>(java.util.Map.of(
                "userId", "c0000006-0000-4000-8000-000000000006",
                "email", "manager@demo.local",
                "token", "jIDh1dQt5kvpE6XCr7MfO1zz7RIB8FeIcUGbYInYzJg")));

        assertThat(redacted).asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("token", CredentialRedactor.REDACTED)
                .as("the key survives so a reader can tell a redaction from an absence")
                .containsKey("token")
                .as("non-credential fields are untouched — the row must stay useful")
                .containsEntry("email", "manager@demo.local")
                .containsEntry("userId", "c0000006-0000-4000-8000-000000000006");

        // The post-D-19 shape passes through intact: tokenId is a row handle, not a credential.
        assertThat(CredentialRedactor.redact(new java.util.LinkedHashMap<>(java.util.Map.of(
                "tokenId", "8b1c9e00-0000-4000-8000-000000000001"))))
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("tokenId", "8b1c9e00-0000-4000-8000-000000000001");
    }

    /**
     * Delegates to {@link CredentialRedactor#namesCredentialMaterial}, which is also what
     * audit-service applies at ingestion time.
     *
     * <p>One definition, two enforcement points. The producer-side rule (this test) stops a
     * credential field being added; the consumer-side rule (the redactor) stops one that already
     * exists in a queued message from reaching an append-only table. They must not be allowed to
     * disagree about what a credential looks like — a term added to one and not the other is a gap
     * that shows up only in the table nobody can edit.
     */
    static boolean namesCredentialMaterial(String fieldName) {
        return CredentialRedactor.namesCredentialMaterial(fieldName);
    }

    private static List<Path> eventPublishingSources() throws IOException {
        Path services = REPO_ROOT.resolve("services");
        List<Path> files = new java.util.ArrayList<>();
        if (!Files.isDirectory(services)) {
            return files;
        }
        try (Stream<Path> walk = Files.walk(services)) {
            walk.filter(Files::isRegularFile)
                .filter(p -> p.toString().endsWith(".java"))
                .filter(p -> p.toString().contains("/src/main/"))
                .filter(p -> !p.toString().contains("/target/"))
                .forEach(files::add);
        }
        return files;
    }
}
