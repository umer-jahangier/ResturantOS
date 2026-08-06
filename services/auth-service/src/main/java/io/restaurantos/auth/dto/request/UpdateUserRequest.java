package io.restaurantos.auth.dto.request;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.Size;

import java.util.Locale;

/**
 * Change a user's profile (D-11). Name, locale and the active flag — nothing else.
 *
 * <h2>A password field is REJECTED, not ignored</h2>
 *
 * <p>Jackson's default is to ignore unknown properties, so {@code {"password":"hunter2"}} would be
 * accepted with a 200 and no password change. An administrator reading that 200 has every reason to
 * believe they set a password. That is worse than a 400: it produces a credential the operator
 * thinks exists and the platform has never heard of, and it is discovered only when the user cannot
 * log in with it.
 *
 * <p>{@link #passwordFieldPresent()} reports whether any password-ish key was in the body, captured
 * by {@link JsonAnySetter} so the check covers whatever a caller actually sent rather than a fixed
 * list of field names — {@code password}, {@code newPassword}, {@code passwordHash} and
 * {@code temp_password} all trip it. The service turns that into a 400 naming the field.
 *
 * <p>Passwords change through the flows that own them: the forced change at first login (13-08),
 * self-service change (13-04), and admin-initiated reset (13-13). Each of those verifies something
 * before it acts; this endpoint verifies nothing about a password because it never touches one.
 *
 * <h2>Null means "leave alone"</h2>
 *
 * <p>Every field is nullable and a null field is not written. That makes the request a patch rather
 * than a replace, so a client that renders three fields cannot blank a fourth it never showed.
 * {@code active} is a boxed Boolean for exactly that reason — a primitive would default to false
 * and every profile edit would deactivate the user.
 */
public class UpdateUserRequest {

    @Size(max = 255)
    private String fullName;

    @Size(max = 10)
    private String locale;

    private Boolean active;

    private boolean passwordFieldPresent;

    public String fullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public String locale() {
        return locale;
    }

    public void setLocale(String locale) {
        this.locale = locale;
    }

    public Boolean active() {
        return active;
    }

    public void setActive(Boolean active) {
        this.active = active;
    }

    /** True when the submitted body carried any password-shaped key. */
    public boolean passwordFieldPresent() {
        return passwordFieldPresent;
    }

    /**
     * Catches every property this record does not declare.
     *
     * <p>Unknown keys are otherwise dropped by Jackson. Rather than failing on all of them — which
     * would break a client that sends a harmless extra field, and would make this endpoint the only
     * strict one in the service — it fails on the one class of field whose silent loss is dangerous.
     * The VALUE is deliberately not stored and never appears in the error: it is a credential the
     * caller has just put on the wire, and echoing it back would put it in a log or a browser
     * console as well.
     */
    @JsonAnySetter
    public void unknownProperty(String name, Object ignoredValue) {
        if (name != null && name.toLowerCase(Locale.ROOT).replace("_", "").contains("password")) {
            this.passwordFieldPresent = true;
        }
    }
}
