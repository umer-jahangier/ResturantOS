package io.restaurantos.crm.service;

import io.restaurantos.crm.dto.CrmDtos.CreateCustomerRequest;
import io.restaurantos.crm.dto.CrmDtos.CustomerLookupResponse;
import io.restaurantos.crm.dto.CrmDtos.CustomerResponse;
import io.restaurantos.crm.dto.CrmDtos.CustomerSummaryResponse;
import io.restaurantos.crm.dto.CrmDtos.UpdateCustomerRequest;
import io.restaurantos.crm.entity.CustomerEntity;
import io.restaurantos.crm.entity.LoyaltyAccountEntity;
import io.restaurantos.crm.repository.CustomerRepository;
import io.restaurantos.crm.repository.LoyaltyAccountRepository;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@Transactional
public class CustomerService {

    private final CustomerRepository customerRepo;
    private final LoyaltyAccountRepository loyaltyAccountRepo;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public CustomerService(CustomerRepository customerRepo,
                           LoyaltyAccountRepository loyaltyAccountRepo,
                           TenantContext tenantContext,
                           EntityManager entityManager) {
        this.customerRepo = customerRepo;
        this.loyaltyAccountRepo = loyaltyAccountRepo;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    private void ensureGuc() {
        TenantGucHelper.apply(entityManager, tenantContext);
    }

    public CustomerResponse create(CreateCustomerRequest req) {
        ensureGuc();
        UUID tenantId = tenantContext.requireTenantId();
        if (customerRepo.findByTenantIdAndPhone(tenantId, req.phone()).isPresent()) {
            throw new IllegalArgumentException("Phone already registered");
        }
        CustomerEntity customer = new CustomerEntity();
        customer.setTenantId(tenantId);
        customer.setPhone(req.phone());
        customer.setName(req.name());
        customer.setEmail(req.email());
        customer.setBirthday(req.birthday());
        customer = customerRepo.save(customer);

        LoyaltyAccountEntity account = new LoyaltyAccountEntity();
        account.setTenantId(tenantId);
        account.setCustomerId(customer.getId());
        loyaltyAccountRepo.save(account);

        return toResponse(customer);
    }

    @Transactional(readOnly = true)
    public CustomerResponse getById(UUID id) {
        ensureGuc();
        return customerRepo.findById(id)
                .map(this::toResponse)
                .orElseThrow(() -> new IllegalArgumentException("Customer not found"));
    }

    /**
     * Customer grid / POS picker. A blank {@code q} lists everyone; otherwise it searches phone
     * (prefix) and name (contains, case-insensitive).
     *
     * <p>Returns loyalty inline. The accounts are fetched in ONE batch query rather than per row —
     * a 50-row page would otherwise be 51 queries, and this endpoint is on the cashier's
     * search-as-you-type path.
     */
    @Transactional(readOnly = true)
    public Page<CustomerSummaryResponse> search(String q, Pageable pageable) {
        ensureGuc();
        UUID tenantId = tenantContext.requireTenantId();
        Page<CustomerEntity> page = (q == null || q.isBlank())
                ? customerRepo.findAllByTenantId(tenantId, pageable)
                : customerRepo.search(tenantId, q.trim(), pageable);

        Map<UUID, LoyaltyAccountEntity> loyalty = page.getContent().isEmpty()
                ? Map.of()
                : loyaltyAccountRepo.findByCustomerIdIn(
                        page.getContent().stream().map(CustomerEntity::getId).toList())
                .stream()
                .collect(Collectors.toMap(LoyaltyAccountEntity::getCustomerId, a -> a));

        return page.map(c -> toSummary(c, loyalty.get(c.getId())));
    }

    /**
     * S0-05 — the ids of every customer in this tenant matching {@code q} by phone prefix or
     * name, capped at {@code limit}.
     *
     * <p>Exists so pos-service's Order Management search can answer "find the check for
     * 0300…" without pos-service holding a copy of the customer book. The cap is not
     * cosmetic: the caller turns this into an {@code IN (…)} predicate, so an uncapped
     * result would let a one-character query build a predicate the width of the tenant.
     * A caller that hits the cap has typed something too broad to be a customer lookup and
     * gets the first {@code limit} matches, deterministically ordered.
     */
    @Transactional(readOnly = true)
    public List<UUID> searchIds(String q, int limit) {
        ensureGuc();
        if (q == null || q.isBlank()) {
            return List.of();
        }
        return customerRepo.searchIds(
                tenantContext.requireTenantId(),
                q.trim(),
                PageRequest.of(0, Math.max(1, limit), Sort.by(Sort.Direction.ASC, "id")));
    }

    @Transactional(readOnly = true)
    public Page<CustomerResponse> list(Pageable pageable) {
        ensureGuc();
        return customerRepo.findAllByTenantId(tenantContext.requireTenantId(), pageable)
                .map(this::toResponse);
    }

    /** One customer with their loyalty standing — the CRM detail page. */
    @Transactional(readOnly = true)
    public CustomerSummaryResponse getDetail(UUID id) {
        ensureGuc();
        CustomerEntity customer = customerRepo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Customer not found"));
        return toSummary(customer, loyaltyAccountRepo.findByCustomerId(id).orElse(null));
    }

    private static CustomerSummaryResponse toSummary(CustomerEntity c, LoyaltyAccountEntity a) {
        return new CustomerSummaryResponse(
                c.getId(), c.getPhone(), c.getName(), c.getEmail(), c.getBirthday(),
                a != null ? a.getTier() : null,
                a != null ? a.getPointsBalance() : 0L,
                a != null ? a.getLifetimeSpendPaisa() : 0L);
    }

    public CustomerResponse update(UUID id, UpdateCustomerRequest req) {
        ensureGuc();
        CustomerEntity customer = customerRepo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Customer not found"));
        if (req.name() != null) {
            customer.setName(req.name());
        }
        if (req.email() != null) {
            customer.setEmail(req.email());
        }
        if (req.birthday() != null) {
            customer.setBirthday(req.birthday());
        }
        customer.setUpdatedAt(Instant.now());
        return toResponse(customerRepo.save(customer));
    }

    public void delete(UUID id) {
        ensureGuc();
        customerRepo.deleteById(id);
    }

    @Transactional(readOnly = true)
    public CustomerLookupResponse lookupByPhone(String phone) {
        ensureGuc();
        UUID tenantId = tenantContext.requireTenantId();
        CustomerEntity customer = customerRepo.findByTenantIdAndPhone(tenantId, phone)
                .orElseThrow(() -> new IllegalArgumentException("Customer not found"));
        LoyaltyAccountEntity account = loyaltyAccountRepo.findByCustomerId(customer.getId())
                .orElseThrow(() -> new IllegalStateException("Loyalty account missing"));
        return new CustomerLookupResponse(
                customer.getId(), customer.getName(), account.getTier(), account.getPointsBalance());
    }

    private CustomerResponse toResponse(CustomerEntity c) {
        return new CustomerResponse(c.getId(), c.getPhone(), c.getName(), c.getEmail(), c.getBirthday());
    }
}
