package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.MenuItem;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MenuItemRepository extends JpaRepository<MenuItem, UUID> {

    /**
     * Order-taking listing for one category, genuinely paged.
     *
     * <p>The unpaged sibling this replaced returned every row and was then wrapped in a
     * {@code PageImpl} carrying the CALLER's page size — so a 30-item category answered a
     * "page 0, size 20" request with 30 rows and metadata claiming a second page existed,
     * and page 1 returned the same 30 rows again. A client that trusted the metadata would
     * have shown every item twice. Slicing in the database is what makes the page metadata
     * this endpoint now publishes true.
     */
    @Query("SELECT i FROM MenuItem i WHERE i.category.id = :categoryId AND i.active = true ORDER BY i.name ASC")
    Page<MenuItem> findByCategoryIdAndActiveTrue(@Param("categoryId") UUID categoryId, Pageable pageable);

    @Query("SELECT i FROM MenuItem i WHERE i.active = true ORDER BY i.name ASC")
    Page<MenuItem> findByActiveTrue(Pageable pageable);

    @Query("SELECT i FROM MenuItem i WHERE i.active = true ORDER BY i.name ASC")
    List<MenuItem> findByActiveTrueOrderByName();

    /** Admin listing (Menu Items management page) — includes inactive items, unlike
     * {@link #findByActiveTrue} which backs the order-taking menu grid. */
    @Query("SELECT i FROM MenuItem i WHERE i.category.id = :categoryId ORDER BY i.name ASC")
    List<MenuItem> findByCategoryIdOrderByName(@Param("categoryId") UUID categoryId);

    @Query("SELECT i FROM MenuItem i ORDER BY i.name ASC")
    Page<MenuItem> findAllOrderByName(Pageable pageable);

    /**
     * Tenant-scoped single-item lookup for the order write path.
     *
     * <p>{@code addItem} previously resolved the caller-supplied {@code menuItemId} with the
     * inherited {@link JpaRepository#findById}, which carries no tenant predicate. With RLS
     * inert on pos_db (owner bypass, fixed in V11) that accepted another tenant's menu item
     * onto an order and priced the line at the foreign tenant's price — a cross-tenant write.
     * FORCE now blocks it at the database; this keeps the predicate in the query too.
     */
    @Query("SELECT i FROM MenuItem i WHERE i.id = :id AND i.tenantId = :tenantId")
    Optional<MenuItem> findByIdAndTenantId(@Param("id") UUID id, @Param("tenantId") UUID tenantId);

    /**
     * Is this file id the picture of one of this tenant's menu items?
     *
     * <p>This is the whole authorisation for {@code GET /api/v1/pos/menu/images/{fileId}}, and it
     * is why that route can be gated on {@code pos.menu.view} instead of on the tenant-wide
     * {@code file.view} the cashier deliberately does not hold. The set of file ids it answers
     * true for is exactly the set of pictures already on the menu the caller may read — an HR
     * document or an invoice scan is not in it, whoever asks.
     *
     * <p>Deliberately NOT filtered on {@code active}: a deactivated dish still appears on the
     * admin screen, and an image that vanishes the moment an item is archived would look like a
     * broken upload rather than an archived dish.
     */
    @Query("""
            SELECT COUNT(i) > 0 FROM MenuItem i
            WHERE i.tenantId = :tenantId AND i.imageFileId = :imageFileId
            """)
    boolean existsByTenantIdAndImageFileId(@Param("tenantId") UUID tenantId,
                                           @Param("imageFileId") UUID imageFileId);
}
