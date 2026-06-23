package io.restaurantos.auth.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "permissions")
@Getter
@Setter
public class PermissionEntity {

    @Id
    private String code;

    @Column(nullable = false)
    private String module;

    private String description;
}
