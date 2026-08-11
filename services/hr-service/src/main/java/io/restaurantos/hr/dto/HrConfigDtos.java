package io.restaurantos.hr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * Request/response DTOs for the tenant-managed HR lists (35-05).
 *
 * <p>Field names here are the paths the client binds server errors to. A rename breaks
 * {@code applyServerFieldErrors} silently on every form that uses them, so treat them as contract.
 */
public final class HrConfigDtos {

    private HrConfigDtos() {
    }

    /**
     * The length bound is a real constraint, not decoration: a 500-character department name breaks
     * every table layout that renders it and is never what someone meant to type.
     */
    public record CreateDepartmentRequest(
            @NotBlank(message = "Enter a department name")
            @Size(max = 80, message = "A department name is at most 80 characters")
            String name,
            @Size(max = 20, message = "A code is at most 20 characters")
            String code) {
    }

    public record RenameDepartmentRequest(
            @NotBlank(message = "Enter a department name")
            @Size(max = 80, message = "A department name is at most 80 characters")
            String name,
            @Size(max = 20, message = "A code is at most 20 characters")
            String code) {
    }

    public record CreateDesignationRequest(
            @NotBlank(message = "Enter a designation name")
            @Size(max = 80, message = "A designation name is at most 80 characters")
            String name,
            @Size(max = 20, message = "A code is at most 20 characters")
            String code,
            /** Optional. Null means this job title is not grouped under any department. */
            UUID departmentId) {
    }

    public record RenameDesignationRequest(
            @NotBlank(message = "Enter a designation name")
            @Size(max = 80, message = "A designation name is at most 80 characters")
            String name,
            @Size(max = 20, message = "A code is at most 20 characters")
            String code,
            UUID departmentId) {
    }

    /**
     * @param active whether this row is offered as an option. Both active and inactive rows are
     *               returned by the list endpoints so a settings screen can show the full history
     *               while a picker filters to active — one endpoint, two legitimate consumers.
     */
    public record DepartmentResponse(UUID id, String name, String code, boolean active) {
    }

    public record DesignationResponse(UUID id, String name, String code, UUID departmentId,
                                      boolean active) {
    }
}
