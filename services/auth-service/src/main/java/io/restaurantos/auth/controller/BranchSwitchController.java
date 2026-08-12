package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.SwitchBranchRequest;
import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.service.BranchSwitchService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class BranchSwitchController {

    private final BranchSwitchService branchSwitchService;

    public BranchSwitchController(BranchSwitchService branchSwitchService) {
        this.branchSwitchService = branchSwitchService;
    }

    /**
     * Switch the caller's active branch.
     *
     * <p>The {@code refresh_token} cookie is read but NOT required (S1-16). It identifies which
     * session is moving, because the active branch is a property of one browser rather than of the
     * account — see {@link BranchSwitchService#switchBranch}. Read leniently, unlike
     * {@code AuthController.readRefreshCookie} which throws: authorisation for this endpoint comes
     * entirely from the access token, so refusing a caller who happens to hold no refresh session
     * would reject a request this service can otherwise answer correctly.
     *
     * <p>The cookie reaches here because its {@code Path} is {@code /api/v1/auth}, of which this
     * route is a child, and the SPA's axios instance sets {@code withCredentials}.
     */
    @PostMapping("/switch-branch")
    public ResponseEntity<ApiResponse<TokenResponse>> switchBranch(
            @Valid @RequestBody SwitchBranchRequest request,
            HttpServletRequest httpRequest) {
        return ResponseEntity.ok(ApiResponse.ok(
            branchSwitchService.switchBranch(request.branchId(), readRefreshCookie(httpRequest))));
    }

    /** The {@code refresh_token} cookie value, or {@code null} when the caller sent none. */
    private static String readRefreshCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if ("refresh_token".equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }
}
