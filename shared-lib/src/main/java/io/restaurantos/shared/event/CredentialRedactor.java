package io.restaurantos.shared.event;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Removes credential material from an event payload before it is written somewhere permanent.
 *
 * <h2>Why a consumer-side control and not just a producer-side rule</h2>
 *
 * <p>Because the producer-side rule is a promise and this is a guarantee, and the difference was
 * measured. 13-09 (D-19) removed a raw password-reset token from {@code PASSWORD_RESET_REQUESTED}
 * and replaced it with a {@code tokenId}. It did not, and could not, remove the messages already
 * sitting in {@code event_outbox}. When 15-01 corrected the audit allow-list, the 3,202-message
 * backlog drained — and three pre-D-19 messages carried their raw tokens straight into
 * {@code audit_events}, a table that is append-only by privilege AND by trigger and is retained for
 * seven years. A credential that lands there cannot be redacted afterwards; the only removal is
 * destroying the audit record along with it.
 *
 * <p>That is the general shape of the problem, not an accident of one migration. audit-service
 * consumes from nine exchanges and ten services it does not control, over a broker that holds
 * messages indefinitely — so any payload it writes may have been authored by code that no longer
 * exists, under rules that have since changed. A consumer that assumes its producers are current is
 * assuming something it cannot check.
 *
 * <p>{@code EventPayloadNoCredentialsTest} enforces the producer-side rule and this enforces the
 * consumer-side one. Both use {@link #namesCredentialMaterial} so there is one definition of what a
 * credential field looks like, and a term added for one is added for both.
 *
 * <h2>Redacted, not dropped</h2>
 *
 * <p>The key survives with its value replaced by {@value #REDACTED}. An auditor reading the row
 * still learns that a token was present and that the platform removed it, which is a materially
 * different fact from a payload that never had one — and silently dropping the key would make a
 * redaction indistinguishable from a producer that simply did not send it.
 */
public final class CredentialRedactor {

    private CredentialRedactor() {}

    public static final String REDACTED = "[REDACTED]";

    /** Credential or identity material outright — flagged even as {@code somethingId}. */
    private static final Set<String> RAW_CREDENTIAL_WORDS = Set.of(
            "password", "passwd", "pwd", "passphrase", "credential",
            "apikey", "privatekey", "cvv", "cnic", "iban");

    /**
     * Words that are credential material but also legitimately name a HANDLE, as {@code <word>Id}.
     *
     * <p>{@code tokenId} is the {@code password_reset_tokens} primary key — worthless without
     * database access, and precisely the shape D-19 replaced the raw token WITH. Redacting it would
     * redact the fix rather than the defect.
     */
    private static final Set<String> HANDLE_BEARING_WORDS = Set.of(
            "token", "secret", "otp", "totp", "hash", "salt", "pin");

    /** Credential material only in combination. */
    private static final Set<String> CREDENTIAL_PHRASES = Set.of(
            "refreshtoken", "accesstoken", "bearertoken", "bankaccount",
            "bankaccountno", "cardnumber", "sessiontoken");

    /** How deep to walk a nested payload before giving up. Payloads are flat by contract. */
    private static final int MAX_DEPTH = 8;

    /**
     * Returns the payload with every credential-named value replaced.
     *
     * <p>Non-map payloads are returned unchanged: typed payload records are covered by
     * {@code EventPayloadNoCredentialsTest} at build time, and the untrusted case in practice is the
     * {@code Map} shape that older producers used.
     */
    public static Object redact(Object payload) {
        return redact(payload, 0);
    }

    private static Object redact(Object payload, int depth) {
        if (depth > MAX_DEPTH || !(payload instanceof Map<?, ?> map)) {
            return payload;
        }
        Map<String, Object> cleaned = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            String key = String.valueOf(entry.getKey());
            Object value = entry.getValue();
            if (namesCredentialMaterial(key)) {
                cleaned.put(key, REDACTED);
            } else if (value instanceof Map<?, ?>) {
                cleaned.put(key, redact(value, depth + 1));
            } else if (value instanceof List<?> list) {
                cleaned.put(key, list.stream().map(v -> redact(v, depth + 1)).toList());
            } else {
                cleaned.put(key, value);
            }
        }
        return cleaned;
    }

    /**
     * True when a field name denotes credential material.
     *
     * <p>Splits camelCase into words rather than matching substrings. Substring matching flags
     * {@code tillSessionId} (a till's business id, via "sessionid") and {@code tokenId} (D-19's
     * fix), and a check that cries wolf on correct code is a check somebody turns off.
     */
    public static boolean namesCredentialMaterial(String fieldName) {
        if (fieldName == null || fieldName.isBlank()) {
            return false;
        }
        String normalised = fieldName.toLowerCase(Locale.ROOT).replace("_", "");

        for (String phrase : CREDENTIAL_PHRASES) {
            if (normalised.contains(phrase)) {
                return true;
            }
        }
        // Raw words are also matched against the flattened name, because camelCase splitting takes
        // apart the ones conventionally written as two words: apiKey → [api, key], neither of which
        // is a credential alone. Safe only for this set — it contains nothing that occurs inside an
        // ordinary business term, which is exactly why "token" and "session" are not in it.
        for (String raw : RAW_CREDENTIAL_WORDS) {
            if (normalised.contains(raw)) {
                return true;
            }
        }

        List<String> words = splitCamelCase(fieldName);
        for (int i = 0; i < words.size(); i++) {
            if (HANDLE_BEARING_WORDS.contains(words.get(i))) {
                boolean trailingHandle = i == words.size() - 2 && "id".equals(words.get(i + 1));
                if (!trailingHandle) {
                    return true;
                }
            }
        }
        return false;
    }

    private static List<String> splitCamelCase(String name) {
        return java.util.Arrays.stream(name.split("(?<!^)(?=[A-Z])|_"))
                .map(s -> s.toLowerCase(Locale.ROOT))
                .filter(s -> !s.isBlank())
                .toList();
    }
}
