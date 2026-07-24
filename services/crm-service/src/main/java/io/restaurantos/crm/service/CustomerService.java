package io.restaurantos.crm.service;

import io.restaurantos.crm.dto.CrmDtos.CreateCustomerRequest;
import io.restaurantos.crm.dto.CrmDtos.CustomerLookupResponse;
import io.restaurantos.crm.dto.CrmDtos.CustomerResponse;
import io.restaurantos.crm.dto.CrmDtos.UpdateCustomerRequest;
import io.restaurantos.crm.entity.CustomerEntity;
import io.restaurantos.crm.entity.LoyaltyAccountEntity;
import io.restaurantos.crm.repository.CustomerRepository;
import io.restaurantos.crm.repository.LoyaltyAccountRepository;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

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

    @Transactional(readOnly = true)
    public Page<CustomerResponse> list(Pageable pageable) {
        ensureGuc();
        return customerRepo.findAllByTenantId(tenantContext.requireTenantId(), pageable)
                .map(this::toResponse);
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
