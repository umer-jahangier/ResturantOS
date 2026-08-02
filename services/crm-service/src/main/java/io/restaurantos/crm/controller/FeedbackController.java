package io.restaurantos.crm.controller;

import io.restaurantos.crm.dto.CrmDtos.FeedbackResponse;
import io.restaurantos.crm.dto.CrmDtos.SubmitFeedbackRequest;
import io.restaurantos.crm.service.FeedbackService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Responses are wrapped in {@link ApiResponse}, matching every other service's controllers.
 * crm-service originally returned raw Spring types, which meant the four-layer frontend client —
 * whose {@code get()} helper unwraps {@code data} — could not consume it at all. Nothing depended
 * on the old shape: this module had no frontend and no HTTP-level test, because until changeset
 * 047 seeded the {@code crm.*} permissions every endpoint here returned 403.
 */
@RestController
@RequestMapping("/api/v1/crm/feedback")
public class FeedbackController {

    private final FeedbackService feedbackService;

    public FeedbackController(FeedbackService feedbackService) {
        this.feedbackService = feedbackService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('crm.customer.manage')")
    public ApiResponse<FeedbackResponse> submit(@Valid @RequestBody SubmitFeedbackRequest req) {
        return ApiResponse.ok(feedbackService.submit(req));
    }

    @GetMapping
    @PreAuthorize("hasAuthority('crm.customer.view')")
    public ApiResponse<Page<FeedbackResponse>> list(Pageable pageable) {
        return ApiResponse.ok(feedbackService.list(pageable));
    }
}
