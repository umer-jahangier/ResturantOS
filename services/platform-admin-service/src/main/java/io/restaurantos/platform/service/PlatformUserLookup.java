package io.restaurantos.platform.service;

import io.restaurantos.platform.entity.PlatformUserEntity;
import io.restaurantos.platform.repository.PlatformUserRepository;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Resolve a {@code platform_users.id} to an email for display.
 *
 * <p>Returns <b>null</b> for an id that names no surviving account rather than a placeholder. An
 * accountability trail must render what it knows: the id is still in the row and still names the
 * actor, and substituting "Unknown" or the id-as-a-name would either hide a deleted operator or
 * manufacture one. This is the same rule {@code ImpersonationRecord} applies to {@code adminEmail}.
 *
 * <p>Null in, null out: a SYSTEM-attributed history row has no operator by construction, and asking
 * for one is not an error.
 */
@Component
public class PlatformUserLookup {

    private final PlatformUserRepository platformUserRepository;

    public PlatformUserLookup(PlatformUserRepository platformUserRepository) {
        this.platformUserRepository = platformUserRepository;
    }

    public String emailOf(UUID platformUserId) {
        if (platformUserId == null) {
            return null;
        }
        return platformUserRepository.findById(platformUserId)
            .map(PlatformUserEntity::getEmail)
            .orElse(null);
    }
}
