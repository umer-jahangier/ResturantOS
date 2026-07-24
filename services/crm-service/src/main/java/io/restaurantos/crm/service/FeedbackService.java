package io.restaurantos.crm.service;

import io.restaurantos.crm.dto.CrmDtos.FeedbackResponse;
import io.restaurantos.crm.dto.CrmDtos.SubmitFeedbackRequest;
import io.restaurantos.crm.entity.CustomerFeedbackEntity;
import io.restaurantos.crm.repository.CustomerFeedbackRepository;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class FeedbackService {

    private final CustomerFeedbackRepository feedbackRepo;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public FeedbackService(CustomerFeedbackRepository feedbackRepo,
                           TenantContext tenantContext,
                           EntityManager entityManager) {
        this.feedbackRepo = feedbackRepo;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    private void ensureGuc() {
        TenantGucHelper.apply(entityManager, tenantContext);
    }

    public FeedbackResponse submit(SubmitFeedbackRequest req) {
        ensureGuc();
        if (req.rating() < 1 || req.rating() > 5) {
            throw new IllegalArgumentException("Rating must be 1-5");
        }
        CustomerFeedbackEntity fb = new CustomerFeedbackEntity();
        fb.setTenantId(tenantContext.requireTenantId());
        fb.setCustomerId(req.customerId());
        fb.setOrderId(req.orderId());
        fb.setRating(req.rating());
        fb.setComment(req.comment());
        fb = feedbackRepo.save(fb);
        return toResponse(fb);
    }

    @Transactional(readOnly = true)
    public Page<FeedbackResponse> list(Pageable pageable) {
        ensureGuc();
        return feedbackRepo.findByTenantId(tenantContext.requireTenantId(), pageable)
                .map(this::toResponse);
    }

    private FeedbackResponse toResponse(CustomerFeedbackEntity fb) {
        return new FeedbackResponse(
                fb.getId(), fb.getCustomerId(), fb.getOrderId(),
                fb.getRating(), fb.getComment(), fb.getCreatedAt());
    }
}
