package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.AnnouncementEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Announcements, newest first. No delete path anywhere — withdrawal sets {@code revoked_at}. */
@Repository
public interface AnnouncementRepository extends JpaRepository<AnnouncementEntity, UUID> {

    List<AnnouncementEntity> findAllByOrderByCreatedAtDesc();

    /**
     * Everything live at {@code now}: published, not revoked, and inside its window.
     *
     * <p>The window test is done in SQL rather than by loading everything and filtering in Java,
     * because the tenant-facing read runs on every page load of every tenant's UI. The partial
     * index {@code ix_announcements_active_window} is built for exactly this predicate.
     */
    @Query("SELECT a FROM AnnouncementEntity a "
        + "WHERE a.revokedAt IS NULL AND a.startsAt <= :now "
        + "AND (a.endsAt IS NULL OR a.endsAt > :now) "
        + "ORDER BY a.severity DESC, a.startsAt DESC")
    List<AnnouncementEntity> findActiveAt(@Param("now") Instant now);
}
