package io.restaurantos.auth.dto.response;

import java.util.List;

/**
 * The one and only delivery of a user's recovery codes.
 *
 * <p>Nothing on the server can reproduce this list afterwards — only SHA-256 digests are kept — so
 * a client that discards this response has cost the user their codes until they regenerate. The UI
 * treats the screen showing it as a checkpoint the user must acknowledge, not a toast.
 */
public record RecoveryCodesResponse(List<String> recoveryCodes) {}
