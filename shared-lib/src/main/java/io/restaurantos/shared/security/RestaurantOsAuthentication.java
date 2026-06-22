package io.restaurantos.shared.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import java.util.Collection;
import java.util.List;

/**
 * Custom Authentication token holding the parsed JWT claims.
 * Phase 2 may use this as an alternative to UsernamePasswordAuthenticationToken.
 * Shipped in shared-lib but NOT wired into any SecurityFilterChain (decision #6).
 */
public class RestaurantOsAuthentication implements Authentication {

    private final JwtClaims claims;
    private final List<SimpleGrantedAuthority> authorities;
    private boolean authenticated = true;

    public RestaurantOsAuthentication(JwtClaims claims) {
        this.claims = claims;
        this.authorities = claims.permissions() == null ? List.of()
            : claims.permissions().stream().map(SimpleGrantedAuthority::new).toList();
    }

    @Override public Collection<? extends GrantedAuthority> getAuthorities() { return authorities; }
    @Override public Object getCredentials() { return null; }
    @Override public Object getDetails() { return null; }
    @Override public Object getPrincipal() { return claims; }
    @Override public boolean isAuthenticated() { return authenticated; }
    @Override public void setAuthenticated(boolean isAuthenticated) { this.authenticated = isAuthenticated; }
    @Override public String getName() { return claims.subject().toString(); }
    public JwtClaims getClaims() { return claims; }
}
