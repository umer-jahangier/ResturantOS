package io.restaurantos.crm.controller;

import io.restaurantos.crm.dto.CrmDtos.FeedbackResponse;
import io.restaurantos.crm.dto.CrmDtos.SubmitFeedbackRequest;
import io.restaurantos.crm.service.FeedbackService;
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
    public FeedbackResponse submit(@Valid @RequestBody SubmitFeedbackRequest req) {
        return feedbackService.submit(req);
    }

    @GetMapping
    @PreAuthorize("hasAuthority('crm.customer.view')")
    public Page<FeedbackResponse> list(Pageable pageable) {
        return feedbackService.list(pageable);
    }
}
