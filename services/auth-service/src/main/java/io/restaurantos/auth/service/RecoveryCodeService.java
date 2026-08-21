package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.RecoveryCodeEntity;
import io.restaurantos.auth.repository.RecoveryCodeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Issues and redeems the single-use codes that get a user back in when the authenticator is gone.
 *
 * <h3>Why a recovery code counts as a completed step-up</h3>
 *
 * Redeeming one sets {@code totpVerified} on the minted JWT, exactly as a live TOTP code does, and
 * that is a decision rather than an oversight. The three permissions behind the step-up gate
 * ({@code rbac.manage}, {@code finance.period.close}, {@code hr.payroll.approve}) are the only
 * reason most of these users hold a second factor at all. A recovery code that admits you to the
 * product but not to the work you were admitted for would leave the payroll approver with a lost
 * phone in the same place they started, which is the whole condition this exists to end.
 *
 * <p>The security argument holds because the code proves the same thing the app does: possession of
 * a secret issued once, to one person, and never re-derivable from anything the server keeps. It is
 * weaker in one specific way — it does not rotate — and the countermeasures are that it is
 * single-use, that it is one of a small fixed pool, and that spending one is a visible event.
 *
 * <h3>Format</h3>
 *
 * Ten codes of ten characters, drawn from a 32-symbol alphabet with {@code I}, {@code O},
 * {@code 0} and {@code 1} removed, rendered as {@code XXXXX-XXXXX}. Fifty bits each. The excluded
 * characters are the ones people transcribe wrongly off a screen or a printout, and a recovery code
 * is read back precisely when the user is already locked out and frustrated.
 *
 * <p>The alphabet is also what lets a recovery code and a TOTP code share the login field: a TOTP
 * code normalises to six characters, a recovery code to ten, so {@link #looksLikeRecoveryCode} can
 * separate them on shape alone without ever guessing.
 */
@Service
public class RecoveryCodeService {

    /** No I, O, 0 or 1 — the four symbols that get transcribed wrongly off a screen. */
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 10;
    private static final int GROUP_SIZE = 5;
    private static final int CODE_COUNT = 10;

    private final RecoveryCodeRepository recoveryCodeRepository;
    private final SecureRandom random = new SecureRandom();

    public RecoveryCodeService(RecoveryCodeRepository recoveryCodeRepository) {
        this.recoveryCodeRepository = recoveryCodeRepository;
    }

    /**
     * Replaces every code this user has with a fresh set, and returns the new ones in plaintext.
     *
     * <p>This is the only moment the plaintext exists. It is returned to the caller and never
     * stored, so the response that carries it is the user's single opportunity to keep it — which
     * is why the UI treats that screen as a checkpoint rather than a notification.
     *
     * <p>Regeneration deletes rather than supplements. A user regenerates because they think the
     * old list is compromised or lost; leaving the old codes live would mean the action they took
     * to secure the account changed nothing about the risk they took it for.
     */
    @Transactional
    public List<String> regenerate(UUID userId, UUID tenantId) {
        recoveryCodeRepository.deleteAllForUser(userId);

        List<String> plaintext = new ArrayList<>(CODE_COUNT);
        Set<String> seen = new HashSet<>();
        while (plaintext.size() < CODE_COUNT) {
            String code = generateCode();
            // A repeat is a ~1-in-2^50 draw, but the table's unique index would reject the insert
            // rather than quietly leave the user one code short, so filter here instead.
            if (seen.add(code)) {
                plaintext.add(code);
            }
        }

        for (String code : plaintext) {
            RecoveryCodeEntity entity = new RecoveryCodeEntity();
            entity.setId(UUID.randomUUID());
            entity.setTenantId(tenantId);
            entity.setUserId(userId);
            entity.setCodeHash(hash(code));
            recoveryCodeRepository.save(entity);
        }
        return plaintext;
    }

    /**
     * Spends one code if it matches an unused one. Returns false for anything else, including a
     * code that was already spent — a used code and a wrong code are the same answer on purpose.
     */
    @Transactional
    public boolean redeem(UUID userId, String candidate) {
        String normalised = normalise(candidate);
        if (!isWellFormed(normalised)) {
            return false;
        }
        return recoveryCodeRepository.redeem(userId, hash(normalised)) == 1;
    }

    /** How many codes are left, for the reminder the settings panel shows. */
    @Transactional(readOnly = true)
    public long remaining(UUID userId) {
        return recoveryCodeRepository.countUnused(userId);
    }

    @Transactional
    public void revokeAll(UUID userId) {
        recoveryCodeRepository.deleteAllForUser(userId);
    }

    /**
     * Whether a string submitted in the login form's code field is shaped like a recovery code
     * rather than a TOTP code.
     *
     * <p>Shape only. This says which of the two checks to run; it never says the code is valid.
     */
    public static boolean looksLikeRecoveryCode(String candidate) {
        return isWellFormed(normalise(candidate));
    }

    private static boolean isWellFormed(String normalised) {
        if (normalised.length() != CODE_LENGTH) {
            return false;
        }
        for (int i = 0; i < normalised.length(); i++) {
            if (ALPHABET.indexOf(normalised.charAt(i)) < 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * Upper-cases and strips everything that is not a letter or digit, so the hyphen we render, any
     * spaces a password manager introduces, and a lower-case retype all reduce to the same string.
     * A user reading a code off paper should not be able to fail on punctuation.
     */
    private static String normalise(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
    }

    private String generateCode() {
        StringBuilder sb = new StringBuilder(CODE_LENGTH + 1);
        for (int i = 0; i < CODE_LENGTH; i++) {
            if (i > 0 && i % GROUP_SIZE == 0) {
                sb.append('-');
            }
            sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return sb.toString();
    }

    private static String hash(String code) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(normalise(code).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is mandated by the JLS for every conforming JRE.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
