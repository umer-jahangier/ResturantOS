package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.AnnouncementAcknowledgementEntity;
import io.restaurantos.platform.entity.AnnouncementAcknowledgementEntity.AckKey;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * The acknowledgement trail.
 *
 * <p>There is no update method and no delete method, and none should be added. An acknowledgement
 * that can be withdrawn or backdated is not a record of anything — the same property the audit log
 * holds, arrived at here by omission rather than by a trigger, because this table is small enough
 * that the omission is checkable by reading it.
 */
@Repository
public interface AnnouncementAcknowledgementRepository
        extends JpaRepository<AnnouncementAcknowledgementEntity, AckKey> {

    List<AnnouncementAcknowledgementEntity> findByAnnouncementIdOrderByAcknowledgedAtDesc(
            UUID announcementId);

    /** Which of these announcements this user has already acknowledged. Empty when none. */
    @Query("SELECT a.announcementId FROM AnnouncementAcknowledgementEntity a "
        + "WHERE a.userId = :userId AND a.announcementId IN :announcementIds")
    List<UUID> findAcknowledgedIds(@Param("userId") UUID userId,
                                   @Param("announcementIds") List<UUID> announcementIds);

    /** {@code (tenantId, count)} — how far an announcement has actually reached, per tenant. */
    @Query("SELECT a.tenantId, COUNT(a) FROM AnnouncementAcknowledgementEntity a "
        + "WHERE a.announcementId = :announcementId GROUP BY a.tenantId")
    List<Object[]> countByTenant(@Param("announcementId") UUID announcementId);

    long countByAnnouncementId(UUID announcementId);
}
