package io.restaurantos.auth.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "restaurantos.auth.cookie")
public class AuthCookieProperties {

    /** When false, allows refresh cookie over plain HTTP (local dev only). */
    private boolean secure = true;

    public boolean isSecure() { return secure; }
    public void setSecure(boolean secure) { this.secure = secure; }
}
