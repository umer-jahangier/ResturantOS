package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.AnnouncementAudienceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/** The targets of an announcement. Replaced wholesale when an announcement is edited, never merged. */
@Repository
public interface AnnouncementAudienceRepository
        extends JpaRepository<AnnouncementAudienceEntity, UUID> {

    List<AnnouncementAudienceEntity> findByAnnouncementId(UUID announcementId);

    /**
     * The audience rows for a batch of announcements, so the tenant-facing read is two queries
     * rather than one per announcement.
     */
    List<AnnouncementAudienceEntity> findByAnnouncementIdIn(List<UUID> announcementIds);
}
